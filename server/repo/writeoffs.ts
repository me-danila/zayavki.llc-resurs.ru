// Репозиторий списаний. Серия списаний по одной партии — атомарно (BEGIN IMMEDIATE).
// Всё-или-ничего: либо все строки вставлены, либо ROLLBACK без следов.

import { db } from "../db";
import { round3, isPositive, gt } from "../lib/num";
import { isValidDate, todayMsk, lte, gte as dateGte } from "../lib/dates";

export type WriteOffInput = {
  date: string;
  licensePlate: string;
  amount: number;
  reason: string;
};

export type CreateSeriesResult =
  | { ok: true; created: number }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "date" }
  | { ok: false; error: "exceeds"; balance: number };

// Создать серию списаний по партии receiptId.
// worker: { id, siteId } — из сессии (доверяем только серверу).
// Правила:
//  - партии нет / партия другого участка → not_found (404, не раскрываем существование)
//  - дата каждой строки: received_date ≤ date ≤ todayMsk(), формат YYYY-MM-DD → иначе 'date'
//  - накопительная сумма серии не должна превышать текущий остаток (с EPS) → иначе 'exceeds'
export function createSeries(
  receiptId: number,
  rows: WriteOffInput[],
  worker: { id: number; siteId: number },
): CreateSeriesResult {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "date" };
  }

  // Явный BEGIN IMMEDIATE — берём write-lock сразу, гонка не уведёт остаток в минус.
  db.exec("BEGIN IMMEDIATE");
  try {
    // Партия + текущий остаток внутри транзакции (консистентный снимок).
    const lot = db
      .query<
        { site_id: number; received_date: string; balance: number },
        [number]
      >(
        `SELECT
           r.site_id       AS site_id,
           r.received_date AS received_date,
           r.qty_initial - COALESCE((
             SELECT SUM(w.qty) FROM writeoffs w WHERE w.receipt_id = r.id
           ), 0)           AS balance
         FROM receipts r
         WHERE r.id = ?`,
      )
      .get(receiptId);

    // Нет партии или чужой участок → одинаково not_found (не раскрываем).
    if (!lot || lot.site_id !== worker.siteId) {
      db.exec("ROLLBACK");
      return { ok: false, error: "not_found" };
    }

    const today = todayMsk();
    const received = lot.received_date;
    const balance = round3(lot.balance);

    const insert = db.query<null, [number, number, string, string, string, number]>(
      `INSERT INTO writeoffs (receipt_id, qty, writeoff_date, license_plate, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    // running — остаток с учётом уже добавленных в этой серии строк.
    let running = balance;
    let created = 0;

    for (const r of rows) {
      const amount = round3(r.amount);

      // Кол-во должно быть положительным (CHECK qty > 0) и числом.
      if (!Number.isFinite(amount) || !isPositive(amount)) {
        db.exec("ROLLBACK");
        return { ok: false, error: "date" };
      }

      // Дата: формат + received_date ≤ date ≤ today (прошлое ок, будущее нет).
      if (
        !isValidDate(r.date) ||
        !dateGte(r.date, received) || // date ≥ received_date
        !lte(r.date, today) // date ≤ today
      ) {
        db.exec("ROLLBACK");
        return { ok: false, error: "date" };
      }

      // Поля-строки должны быть непустыми.
      if (
        !r.licensePlate ||
        !r.licensePlate.trim() ||
        !r.reason ||
        !r.reason.trim()
      ) {
        db.exec("ROLLBACK");
        return { ok: false, error: "date" };
      }

      // Накопительная проверка: amount не должен превышать оставшийся running (с EPS).
      // amount > running + EPS → превышение.
      if (gt(amount, running)) {
        db.exec("ROLLBACK");
        return { ok: false, error: "exceeds", balance };
      }

      running = round3(running - amount);

      insert.run(
        receiptId,
        amount,
        r.date,
        r.licensePlate.trim(),
        r.reason.trim(),
        worker.id,
      );
      created++;
    }

    db.exec("COMMIT");
    return { ok: true, created };
  } catch (err) {
    // Любая ошибка (в т.ч. триггеры/CHECK) — откат, не оставляем открытую транзакцию.
    try {
      db.exec("ROLLBACK");
    } catch {
      // транзакция уже завершена — игнорируем
    }
    throw err;
  }
}
