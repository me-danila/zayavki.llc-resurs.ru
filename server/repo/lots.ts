// Репозиторий партий (lots). Партия = строка receipts + её списания.
// Остаток = qty_initial − Σ writeoffs.qty. Активная: balance > EPS, архив: balance ≤ EPS.

import { db } from "../db";
import { round3 } from "../lib/num";
import type { Lot, HistoryEvent } from "./types";

// Сырая строка из SELECT по списку партий.
type LotListRow = {
  id: number;
  name: string;
  code: string;
  site_id: number;
  site_name: string;
  unit: string;
  qty_initial: number;
  balance: number;
  received_date: string;
  created_by: number;
  author_username: string | null;
  author_display_name: string | null;
};

function mapLot(r: LotListRow): Lot {
  const initialQty = round3(r.qty_initial);
  const balance = round3(r.balance);
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    siteId: r.site_id,
    siteName: r.site_name,
    unit: r.unit,
    initialQty,
    balance,
    receivedDate: r.received_date,
    author: {
      username: r.author_username ?? "",
      displayName: r.author_display_name,
    },
  };
}

// Базовый SELECT с подсчётом остатка и автором.
// balance = qty_initial − COALESCE(SUM(writeoffs.qty), 0).
// author из users(created_by) — БЕЗ фильтра is_active (показываем и удалённых менеджеров).
const LIST_SELECT = `
  SELECT
    r.id            AS id,
    r.name          AS name,
    r.code          AS code,
    r.site_id       AS site_id,
    s.name          AS site_name,
    r.unit          AS unit,
    r.qty_initial   AS qty_initial,
    r.received_date AS received_date,
    r.created_by    AS created_by,
    au.username     AS author_username,
    au.display_name AS author_display_name,
    r.qty_initial - COALESCE((
      SELECT SUM(w.qty) FROM writeoffs w WHERE w.receipt_id = r.id
    ), 0)           AS balance
  FROM receipts r
  JOIN sites s ON s.id = r.site_id
  LEFT JOIN users au ON au.id = r.created_by
`;

// Список партий. Опционально фильтр по участку (для воркера — его site).
// Сортировка: сначала активные (balance > EPS), затем по received_date DESC, id DESC.
export function list(opts: { siteId?: number } = {}): Lot[] {
  // Активность считаем в SQL тем же эпсилон-порогом, что и на беке/фронте.
  const activeExpr =
    "(r.qty_initial - COALESCE((SELECT SUM(w.qty) FROM writeoffs w WHERE w.receipt_id = r.id), 0)) > 1e-9";

  const where = opts.siteId != null ? "WHERE r.site_id = ?" : "";
  const order = `ORDER BY ${activeExpr} DESC, r.received_date DESC, r.id DESC`;
  const sql = `${LIST_SELECT} ${where} ${order}`;

  const rows =
    opts.siteId != null
      ? db.query<LotListRow, [number]>(sql).all(opts.siteId)
      : db.query<LotListRow, []>(sql).all();

  return rows.map(mapLot);
}

// Лёгкая выборка партии для проверок (списание/доступ). null если нет.
export function getById(id: number): {
  id: number;
  siteId: number;
  siteName: string;
  receivedDate: string;
  unit: string;
  name: string;
  code: string;
} | null {
  const row = db
    .query<
      {
        id: number;
        site_id: number;
        site_name: string;
        received_date: string;
        unit: string;
        name: string;
        code: string;
      },
      [number]
    >(
      `SELECT r.id            AS id,
              r.site_id       AS site_id,
              s.name          AS site_name,
              r.received_date AS received_date,
              r.unit          AS unit,
              r.name          AS name,
              r.code          AS code
         FROM receipts r
         JOIN sites s ON s.id = r.site_id
        WHERE r.id = ?`,
    )
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name,
    receivedDate: row.received_date,
    unit: row.unit,
    name: row.name,
    code: row.code,
  };
}

// История партии: приход (kind='receipt') + все списания (kind='writeoff').
// balanceAfter — нарастающий остаток. Авторы из users БЕЗ фильтра is_active.
// Сортировка событий: по дате, затем по id (порядок вставки). null если партии нет.
export function history(
  id: number,
): { lot: Lot; events: HistoryEvent[] } | null {
  const lotRow = db
    .query<LotListRow, [number]>(`${LIST_SELECT} WHERE r.id = ?`)
    .get(id);
  if (!lotRow) return null;

  const lot = mapLot(lotRow);

  // Списания в порядке: дата ASC, затем id ASC (стабильно по вставке).
  const wos = db
    .query<
      {
        id: number;
        qty: number;
        writeoff_date: string;
        license_plate: string;
        reason: string;
        author_username: string | null;
        author_display_name: string | null;
      },
      [number]
    >(
      `SELECT
         w.id            AS id,
         w.qty           AS qty,
         w.writeoff_date AS writeoff_date,
         w.license_plate AS license_plate,
         w.reason        AS reason,
         au.username     AS author_username,
         au.display_name AS author_display_name
       FROM writeoffs w
       LEFT JOIN users au ON au.id = w.created_by
       WHERE w.receipt_id = ?
       ORDER BY w.writeoff_date ASC, w.id ASC`,
    )
    .all(id);

  const events: HistoryEvent[] = [];

  // Первое событие — приход (нарастающий остаток стартует с initialQty).
  let running = lot.initialQty;
  // Автор прихода = автор партии (lot.author).
  events.push({
    kind: "receipt",
    date: lot.receivedDate,
    qty: lot.initialQty,
    balanceAfter: round3(running),
    author: lot.author,
  });

  for (const w of wos) {
    const qty = round3(w.qty);
    running = round3(running - qty);
    events.push({
      kind: "writeoff",
      date: w.writeoff_date,
      qty,
      balanceAfter: running,
      licensePlate: w.license_plate,
      reason: w.reason,
      author: {
        username: w.author_username ?? "",
        displayName: w.author_display_name,
      },
    });
  }

  // Финальный running после всех списаний совпадает с lot.balance (тот же round3/EPS).
  return { lot, events };
}
