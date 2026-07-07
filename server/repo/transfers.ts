// Репозиторий перемещений (transfers). Перемещение N единиц из партии A (участок X)
// на участок Y — атомарно в одной транзакции (BEGIN IMMEDIATE):
//   1) INSERT writeoff на исходную партию A (reason='Перемещение') — уменьшает остаток A.
//   2) INSERT новой партии на участок Y (копии name/code/unit, qty_initial=N).
//   3) INSERT в transfers (связка).
// Append-only сохраняется (только INSERT). При любой ошибке — ROLLBACK.

import { db } from "../db";
import { round3, gt } from "../lib/num";
import { isValidDate, todayMsk, lte, gte as dateGte } from "../lib/dates";
import { RECEIPT_CORR_JOIN, RECEIPT_NOT_VOIDED, BALANCE_EFF } from "./lots";

export type TransferActor = {
  id: number;
  role: "manager" | "worker";
  siteId: number | null;
};

export type CreateTransferResult =
  | { ok: true; toReceiptId: number }
  | {
      ok: false;
      error:
        | "not_found"
        | "forbidden"
        | "date"
        | "same_site"
        | "inactive_site"
        | "exceeds";
      balance?: number;
    };

// Создать перемещение партии fromReceiptId на участок toSiteId, qty единиц, датой date.
// Правила:
//  - партии нет → not_found; воркер и партия чужого участка → not_found (маскируем).
//  - toSiteId не активен (sites.is_active≠1) → inactive_site.
//  - toSiteId === site исходной партии → same_site.
//  - дата невалидна или вне [received_date(A); todayMsk()] → date.
//  - qty (round3) > остаток A (gt с EPS) → exceeds + balance.
export function create(
  fromReceiptId: number,
  toSiteId: number,
  qty: number,
  date: string,
  actor: TransferActor,
): CreateTransferResult {
  // Явный BEGIN IMMEDIATE — write-lock сразу, гонка не уведёт остаток A в минус.
  db.exec("BEGIN IMMEDIATE");
  try {
    // Исходная партия + текущий остаток внутри транзакции (консистентный снимок).
    // Значения эффективные (v4): корректировки прихода/списаний учтены,
    // voided-партия «не существует» (нет строки → not_found).
    const lot = db
      .query<
        {
          site_id: number;
          received_date: string;
          name: string;
          code: string;
          unit: string;
          balance: number;
        },
        [number]
      >(
        `SELECT
           r.site_id                              AS site_id,
           COALESCE(cr.new_date, r.received_date) AS received_date,
           COALESCE(cr.new_name, r.name)          AS name,
           COALESCE(cr.new_code, r.code)          AS code,
           COALESCE(cr.new_unit, r.unit)          AS unit,
           ${BALANCE_EFF}                         AS balance
         FROM receipts r
         ${RECEIPT_CORR_JOIN}
         WHERE r.id = ? AND ${RECEIPT_NOT_VOIDED}`,
      )
      .get(fromReceiptId);

    // Нет партии → not_found. Воркер и чужой участок → not_found (маскируем существование).
    if (!lot) {
      db.exec("ROLLBACK");
      return { ok: false, error: "not_found" };
    }
    if (actor.role === "worker" && lot.site_id !== actor.siteId) {
      db.exec("ROLLBACK");
      return { ok: false, error: "not_found" };
    }

    // Целевой участок должен быть активным.
    const target = db
      .query<{ is_active: number }, [number]>(
        "SELECT is_active FROM sites WHERE id = ?",
      )
      .get(toSiteId);
    if (!target || target.is_active !== 1) {
      db.exec("ROLLBACK");
      return { ok: false, error: "inactive_site" };
    }

    // Целевой участок не должен совпадать с исходным.
    if (toSiteId === lot.site_id) {
      db.exec("ROLLBACK");
      return { ok: false, error: "same_site" };
    }

    const amount = round3(qty);
    if (!Number.isFinite(amount) || amount <= 0) {
      db.exec("ROLLBACK");
      return { ok: false, error: "date" };
    }

    // Дата: формат + received_date ≤ date ≤ today (прошлое ок, будущее нет).
    const today = todayMsk();
    if (
      !isValidDate(date) ||
      !dateGte(date, lot.received_date) || // date ≥ received_date
      !lte(date, today) // date ≤ today
    ) {
      db.exec("ROLLBACK");
      return { ok: false, error: "date" };
    }

    const balance = round3(lot.balance);
    // qty не должен превышать текущий остаток A (с EPS).
    if (gt(amount, balance)) {
      db.exec("ROLLBACK");
      return { ok: false, error: "exceeds", balance };
    }

    // 1) Списание с исходной партии (штатная логика уменьшения остатка A).
    const wo = db
      .query<{ id: number }, [number, number, string, string, string, number]>(
        `INSERT INTO writeoffs (receipt_id, qty, writeoff_date, license_plate, reason, created_by)
         VALUES (?, ?, ?, '', 'Перемещение', ?)
         RETURNING id`,
      )
      .get(fromReceiptId, amount, date, actor.id)!;

    // 2) Новая партия на целевом участке (копии name/code/unit).
    const rcpt = db
      .query<{ id: number }, [number, string, string, string, number, string, number]>(
        `INSERT INTO receipts (site_id, name, code, unit, qty_initial, received_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(
        toSiteId,
        lot.name,
        lot.code,
        lot.unit,
        amount,
        date,
        actor.id,
      )!;

    // 3) Связка transfers.
    db.query<null, [number, number, number, number, string, number]>(
      `INSERT INTO transfers (from_receipt_id, to_receipt_id, writeoff_id, qty, transfer_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(fromReceiptId, rcpt.id, wo.id, amount, date, actor.id);

    db.exec("COMMIT");
    return { ok: true, toReceiptId: rcpt.id };
  } catch (err) {
    // Любая ошибка (триггеры/CHECK/FK) — откат, не оставляем открытую транзакцию.
    try {
      db.exec("ROLLBACK");
    } catch {
      // транзакция уже завершена — игнорируем
    }
    throw err;
  }
}
