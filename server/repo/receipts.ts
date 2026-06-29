// Репозиторий приходов (партий). Один приход = одна партия (Model A).
// createMany — мульти-приход одной транзакцией, всё-или-ничего.

import { db } from "../db";
import { round3, isPositive } from "../lib/num";
import { isValidDate } from "../lib/dates";

export type ReceiptInput = {
  receivedDate: string;
  siteId: number;
  name: string;
  code: string;
  unit?: string;
  quantity: number;
};

// Структурная валидация одной строки прихода.
// Проверку активности siteId делает слой роутов — здесь только формат/непустота/число.
function validateRow(r: ReceiptInput, qty: number): void {
  if (typeof r.siteId !== "number" || !Number.isInteger(r.siteId) || r.siteId <= 0) {
    throw new Error("invalid_site");
  }
  if (!r.name || typeof r.name !== "string" || !r.name.trim()) {
    throw new Error("invalid_name");
  }
  if (!r.code || typeof r.code !== "string" || !r.code.trim()) {
    throw new Error("invalid_code");
  }
  if (!isValidDate(r.receivedDate)) {
    throw new Error("invalid_date");
  }
  // qty уже округлён; должен быть строго положительным (CHECK qty_initial > 0).
  if (!Number.isFinite(qty) || !isPositive(qty)) {
    throw new Error("invalid_quantity");
  }
}

// Создать N партий одной транзакцией. createdBy — id менеджера из сессии.
// Кол-ва округляются до 3 знаков на входе (политика §3.1).
export function createMany(
  rows: ReceiptInput[],
  createdBy: number,
): { created: number } {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("empty_rows");
  }

  const insert = db.query<null, [number, string, string, string, number, string, number]>(
    `INSERT INTO receipts (site_id, name, code, unit, qty_initial, received_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  // Одна транзакция: либо все строки, либо ни одной.
  const run = db.transaction((items: ReceiptInput[]) => {
    let created = 0;
    for (const r of items) {
      const qty = round3(r.quantity);
      validateRow(r, qty);
      const unit = r.unit && r.unit.trim() ? r.unit.trim() : "л";
      insert.run(
        r.siteId,
        r.name.trim(),
        r.code.trim(),
        unit,
        qty,
        r.receivedDate,
        createdBy,
      );
      created++;
    }
    return created;
  });

  const created = run(rows);
  return { created };
}
