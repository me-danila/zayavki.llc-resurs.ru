// Репозиторий корректировок (v4). Сторно (void) и правка (edit) записей
// receipts/writeoffs менеджером БЕЗ UPDATE: каждая корректировка — новая строка
// в corrections, действует последняя (max id per (target_kind, target_id)).
// При action='edit' заполняем ВСЕ new_*-поля целевого типа СНАПШОТОМ итогового
// состояния (эффективные значения), поэтому выборкам достаточно последней строки.
// Гарды — в транзакции BEGIN IMMEDIATE (гонка не уведёт остаток в минус).

import { db } from "../db";
import { round3, isPositive, gt, gte } from "../lib/num";
import { isValidDate } from "../lib/dates";
import {
  RECEIPT_CORR_JOIN,
  WRITEOFF_CORR_JOIN,
  WRITEOFFS_EFF_SUM,
  BALANCE_EFF,
} from "./lots";

export type WriteoffCorrectionInput =
  | { action: "void" }
  | {
      action: "edit";
      date?: string;
      amount?: number;
      licensePlate?: string;
      reason?: string;
    };

export type ReceiptCorrectionInput =
  | { action: "void" }
  | {
      action: "edit";
      receivedDate?: string;
      name?: string;
      code?: string;
      unit?: string;
      quantity?: number;
    };

export type CorrectWriteoffResult =
  | { ok: true; id: number }
  | {
      ok: false;
      error: "not_found" | "transfer_locked" | "already_voided" | "invalid";
    }
  | { ok: false; error: "exceeds"; balance: number };

export type CorrectReceiptResult =
  | { ok: true; id: number }
  | {
      ok: false;
      error:
        | "not_found"
        | "transfer_locked"
        | "already_voided"
        | "has_writeoffs"
        | "invalid";
    }
  | { ok: false; error: "exceeds"; balance: number };

// INSERT одной корректировки. Возвращает id новой строки.
const insertCorrection = db.query<
  { id: number },
  [
    string, // target_kind
    number, // target_id
    string, // action
    string | null, // new_date
    number | null, // new_qty
    string | null, // new_name
    string | null, // new_code
    string | null, // new_unit
    string | null, // new_license_plate
    string | null, // new_reason
    number, // created_by
  ]
>(
  `INSERT INTO corrections
     (target_kind, target_id, action, new_date, new_qty, new_name, new_code, new_unit, new_license_plate, new_reason, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   RETURNING id`,
);

// Корректировка списания writeoffId менеджером managerId.
// Гарды: not_found → transfer_locked (списание-перемещение неприкосновенно) →
// already_voided (после void запись мертва, любые корректировки запрещены) →
// invalid (валидация полей) → exceeds (рост qty не должен увести остаток партии в минус).
export function correctWriteoff(
  writeoffId: number,
  input: WriteoffCorrectionInput,
  managerId: number,
): CorrectWriteoffResult {
  // Явный BEGIN IMMEDIATE — write-lock сразу, гонка не уведёт остаток в минус.
  db.exec("BEGIN IMMEDIATE");
  try {
    // Списание + действующая корректировка + признак «связано с перемещением».
    const wo = db
      .query<
        {
          receipt_id: number;
          qty: number;
          writeoff_date: string;
          license_plate: string;
          reason: string;
          corr_action: string | null;
          corr_qty: number | null;
          corr_date: string | null;
          corr_license_plate: string | null;
          corr_reason: string | null;
          locked: number;
        },
        [number]
      >(
        `SELECT
           w.receipt_id         AS receipt_id,
           w.qty                AS qty,
           w.writeoff_date      AS writeoff_date,
           w.license_plate      AS license_plate,
           w.reason             AS reason,
           cw.action            AS corr_action,
           cw.new_qty           AS corr_qty,
           cw.new_date          AS corr_date,
           cw.new_license_plate AS corr_license_plate,
           cw.new_reason        AS corr_reason,
           EXISTS(SELECT 1 FROM transfers t WHERE t.writeoff_id = w.id) AS locked
         FROM writeoffs w
         ${WRITEOFF_CORR_JOIN}
         WHERE w.id = ?`,
      )
      .get(writeoffId);

    if (!wo) {
      db.exec("ROLLBACK");
      return { ok: false, error: "not_found" };
    }
    if (wo.locked) {
      db.exec("ROLLBACK");
      return { ok: false, error: "transfer_locked" };
    }
    if (wo.corr_action === "void") {
      db.exec("ROLLBACK");
      return { ok: false, error: "already_voided" };
    }

    if (input.action === "void") {
      const row = insertCorrection.get(
        "writeoff",
        writeoffId,
        "void",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        managerId,
      )!;
      db.exec("COMMIT");
      return { ok: true, id: row.id };
    }

    // edit: эффективные текущие значения (снапшот действующей edit-корректировки или оригинал).
    const effQty = round3(wo.corr_qty ?? wo.qty);
    const effDate = wo.corr_date ?? wo.writeoff_date;
    const effPlate = wo.corr_license_plate ?? wo.license_plate;
    const effReason = wo.corr_reason ?? wo.reason;

    // Хотя бы одно поле должно меняться.
    if (
      input.date === undefined &&
      input.amount === undefined &&
      input.licensePlate === undefined &&
      input.reason === undefined
    ) {
      db.exec("ROLLBACK");
      return { ok: false, error: "invalid" };
    }

    let newQty = effQty;
    if (input.amount !== undefined) {
      const amount = round3(input.amount);
      if (!Number.isFinite(amount) || !isPositive(amount)) {
        db.exec("ROLLBACK");
        return { ok: false, error: "invalid" };
      }
      newQty = amount;
    }

    let newDate = effDate;
    if (input.date !== undefined) {
      if (typeof input.date !== "string" || !isValidDate(input.date)) {
        db.exec("ROLLBACK");
        return { ok: false, error: "invalid" };
      }
      newDate = input.date;
    }

    let newPlate = effPlate;
    if (input.licensePlate !== undefined) {
      if (typeof input.licensePlate !== "string" || !input.licensePlate.trim()) {
        db.exec("ROLLBACK");
        return { ok: false, error: "invalid" };
      }
      newPlate = input.licensePlate.trim();
    }

    let newReason = effReason;
    if (input.reason !== undefined) {
      if (typeof input.reason !== "string" || !input.reason.trim()) {
        db.exec("ROLLBACK");
        return { ok: false, error: "invalid" };
      }
      newReason = input.reason.trim();
    }

    // Рост qty не должен увести эффективный остаток партии в минус:
    // (newQty − effQty) ≤ balance + EPS. Баланс уже учитывает это списание по effQty.
    const balRow = db
      .query<{ balance: number }, [number]>(
        `SELECT ${BALANCE_EFF} AS balance
           FROM receipts r
           ${RECEIPT_CORR_JOIN}
          WHERE r.id = ?`,
      )
      .get(wo.receipt_id)!;
    const balance = round3(balRow.balance);
    if (gt(round3(newQty - effQty), balance)) {
      db.exec("ROLLBACK");
      return { ok: false, error: "exceeds", balance };
    }

    const row = insertCorrection.get(
      "writeoff",
      writeoffId,
      "edit",
      newDate,
      newQty,
      null,
      null,
      null,
      newPlate,
      newReason,
      managerId,
    )!;
    db.exec("COMMIT");
    return { ok: true, id: row.id };
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

// Корректировка прихода (партии) receiptId менеджером managerId. Участок партии НЕ меняется.
// Гарды: not_found → transfer_locked (партия участвует в перемещении с любой стороны) →
// already_voided → has_writeoffs (void только без активных списаний) →
// invalid → exceeds (новое quantity не меньше Σ эффективных активных списаний).
export function correctReceipt(
  receiptId: number,
  input: ReceiptCorrectionInput,
  managerId: number,
): CorrectReceiptResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const rcpt = db
      .query<
        {
          qty_initial: number;
          received_date: string;
          name: string;
          code: string;
          unit: string;
          corr_action: string | null;
          corr_qty: number | null;
          corr_date: string | null;
          corr_name: string | null;
          corr_code: string | null;
          corr_unit: string | null;
          locked: number;
          wo_sum: number;
          has_active_writeoffs: number;
        },
        [number]
      >(
        `SELECT
           r.qty_initial   AS qty_initial,
           r.received_date AS received_date,
           r.name          AS name,
           r.code          AS code,
           r.unit          AS unit,
           cr.action       AS corr_action,
           cr.new_qty      AS corr_qty,
           cr.new_date     AS corr_date,
           cr.new_name     AS corr_name,
           cr.new_code     AS corr_code,
           cr.new_unit     AS corr_unit,
           EXISTS(
             SELECT 1 FROM transfers t
             WHERE t.from_receipt_id = r.id OR t.to_receipt_id = r.id
           ) AS locked,
           ${WRITEOFFS_EFF_SUM} AS wo_sum,
           EXISTS(
             SELECT 1 FROM writeoffs w
             ${WRITEOFF_CORR_JOIN}
             WHERE w.receipt_id = r.id
               AND (cw.action IS NULL OR cw.action <> 'void')
           ) AS has_active_writeoffs
         FROM receipts r
         ${RECEIPT_CORR_JOIN}
         WHERE r.id = ?`,
      )
      .get(receiptId);

    if (!rcpt) {
      db.exec("ROLLBACK");
      return { ok: false, error: "not_found" };
    }
    if (rcpt.locked) {
      db.exec("ROLLBACK");
      return { ok: false, error: "transfer_locked" };
    }
    if (rcpt.corr_action === "void") {
      db.exec("ROLLBACK");
      return { ok: false, error: "already_voided" };
    }

    if (input.action === "void") {
      // Сторно партии допустимо только без активных (не-voided) списаний.
      if (rcpt.has_active_writeoffs) {
        db.exec("ROLLBACK");
        return { ok: false, error: "has_writeoffs" };
      }
      const row = insertCorrection.get(
        "receipt",
        receiptId,
        "void",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        managerId,
      )!;
      db.exec("COMMIT");
      return { ok: true, id: row.id };
    }

    // edit: эффективные текущие значения (снапшот действующей edit-корректировки или оригинал).
    const effQty = round3(rcpt.corr_qty ?? rcpt.qty_initial);
    const effDate = rcpt.corr_date ?? rcpt.received_date;
    const effName = rcpt.corr_name ?? rcpt.name;
    const effCode = rcpt.corr_code ?? rcpt.code;
    const effUnit = rcpt.corr_unit ?? rcpt.unit;

    // Хотя бы одно поле должно меняться.
    if (
      input.receivedDate === undefined &&
      input.name === undefined &&
      input.code === undefined &&
      input.unit === undefined &&
      input.quantity === undefined
    ) {
      db.exec("ROLLBACK");
      return { ok: false, error: "invalid" };
    }

    let newQty = effQty;
    if (input.quantity !== undefined) {
      const qty = round3(input.quantity);
      if (!Number.isFinite(qty) || !isPositive(qty)) {
        db.exec("ROLLBACK");
        return { ok: false, error: "invalid" };
      }
      newQty = qty;
    }

    let newDate = effDate;
    if (input.receivedDate !== undefined) {
      if (
        typeof input.receivedDate !== "string" ||
        !isValidDate(input.receivedDate)
      ) {
        db.exec("ROLLBACK");
        return { ok: false, error: "invalid" };
      }
      newDate = input.receivedDate;
    }

    let newName = effName;
    if (input.name !== undefined) {
      if (typeof input.name !== "string" || !input.name.trim()) {
        db.exec("ROLLBACK");
        return { ok: false, error: "invalid" };
      }
      newName = input.name.trim();
    }

    let newCode = effCode;
    if (input.code !== undefined) {
      if (typeof input.code !== "string" || !input.code.trim()) {
        db.exec("ROLLBACK");
        return { ok: false, error: "invalid" };
      }
      newCode = input.code.trim();
    }

    let newUnit = effUnit;
    if (input.unit !== undefined) {
      if (typeof input.unit !== "string" || !input.unit.trim()) {
        db.exec("ROLLBACK");
        return { ok: false, error: "invalid" };
      }
      newUnit = input.unit.trim();
    }

    // Новое количество партии не должно стать меньше Σ эффективных активных списаний:
    // newQty ≥ wo_sum − EPS, иначе остаток ушёл бы в минус.
    const woSum = round3(rcpt.wo_sum);
    if (!gte(newQty, woSum)) {
      db.exec("ROLLBACK");
      return { ok: false, error: "exceeds", balance: round3(effQty - woSum) };
    }

    const row = insertCorrection.get(
      "receipt",
      receiptId,
      "edit",
      newDate,
      newQty,
      newName,
      newCode,
      newUnit,
      null,
      null,
      managerId,
    )!;
    db.exec("COMMIT");
    return { ok: true, id: row.id };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // транзакция уже завершена — игнорируем
    }
    throw err;
  }
}
