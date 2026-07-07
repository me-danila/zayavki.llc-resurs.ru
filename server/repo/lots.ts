// Репозиторий партий (lots). Партия = строка receipts + её списания.
// С v4 значения ЭФФЕКТИВНЫЕ: действует последняя корректировка (corrections).
// Остаток = qty_initial_eff − Σ эффективных списаний (voided-списания = 0).
// Активная: balance > EPS, архив: balance ≤ EPS. Voided-приход из выборок исключается.

import { db } from "../db";
import { round3 } from "../lib/num";
import type { Lot, HistoryEvent } from "./types";

// ---------------------------------------------------------------------------
// Переиспользуемые SQL-фрагменты «последняя корректировка» (v4).
// Единая точка логики эффективных значений — сюда смотрят writeoffs/transfers/sites.
// Соглашение по алиасам: receipts → r, корректировка прихода → cr,
// writeoffs → w, корректировка списания → cw.
// ---------------------------------------------------------------------------

// Последняя корректировка прихода r (алиас cr). NULL-строка, если корректировок нет.
export const RECEIPT_CORR_JOIN = `
  LEFT JOIN corrections cr ON cr.id = (
    SELECT MAX(c2.id) FROM corrections c2
    WHERE c2.target_kind = 'receipt' AND c2.target_id = r.id
  )`;

// Последняя корректировка списания w (алиас cw).
export const WRITEOFF_CORR_JOIN = `
  LEFT JOIN corrections cw ON cw.id = (
    SELECT MAX(c3.id) FROM corrections c3
    WHERE c3.target_kind = 'writeoff' AND c3.target_id = w.id
  )`;

// Приход не аннулирован (действующая корректировка не void). Требует RECEIPT_CORR_JOIN.
export const RECEIPT_NOT_VOIDED = `(cr.action IS NULL OR cr.action <> 'void')`;

// Σ эффективных списаний партии r.id: voided-списание = 0, edited — снапшот new_qty
// (edit-корректировка всегда заполняет new_qty, поэтому COALESCE достаточно).
export const WRITEOFFS_EFF_SUM = `
  COALESCE((
    SELECT SUM(CASE WHEN cw.action = 'void' THEN 0 ELSE COALESCE(cw.new_qty, w.qty) END)
    FROM writeoffs w
    ${WRITEOFF_CORR_JOIN}
    WHERE w.receipt_id = r.id
  ), 0)`;

// Эффективный остаток партии r (учитывает корректировки и прихода, и списаний).
// Требует RECEIPT_CORR_JOIN в запросе.
export const BALANCE_EFF = `(COALESCE(cr.new_qty, r.qty_initial) - ${WRITEOFFS_EFF_SUM})`;

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

// Базовый SELECT с эффективными значениями, остатком и автором.
// author из users(created_by) — БЕЗ фильтра is_active (показываем и удалённых менеджеров).
const LIST_SELECT = `
  SELECT
    r.id                                       AS id,
    COALESCE(cr.new_name, r.name)              AS name,
    COALESCE(cr.new_code, r.code)              AS code,
    r.site_id                                  AS site_id,
    s.name                                     AS site_name,
    COALESCE(cr.new_unit, r.unit)              AS unit,
    COALESCE(cr.new_qty, r.qty_initial)        AS qty_initial,
    COALESCE(cr.new_date, r.received_date)     AS received_date,
    r.created_by                               AS created_by,
    au.username                                AS author_username,
    au.display_name                            AS author_display_name,
    ${BALANCE_EFF}                             AS balance
  FROM receipts r
  JOIN sites s ON s.id = r.site_id
  LEFT JOIN users au ON au.id = r.created_by
  ${RECEIPT_CORR_JOIN}
`;

// Список партий. Опционально фильтр по участку (для воркера — его site).
// Voided-приходы исключаются. Сортировка: сначала активные (balance > EPS),
// затем по эффективной received_date DESC, id DESC.
export function list(opts: { siteId?: number } = {}): Lot[] {
  // Активность считаем в SQL тем же эпсилон-порогом, что и на беке/фронте.
  const activeExpr = `${BALANCE_EFF} > 1e-9`;

  const where =
    opts.siteId != null
      ? `WHERE ${RECEIPT_NOT_VOIDED} AND r.site_id = ?`
      : `WHERE ${RECEIPT_NOT_VOIDED}`;
  const order = `ORDER BY ${activeExpr} DESC, COALESCE(cr.new_date, r.received_date) DESC, r.id DESC`;
  const sql = `${LIST_SELECT} ${where} ${order}`;

  const rows =
    opts.siteId != null
      ? db.query<LotListRow, [number]>(sql).all(opts.siteId)
      : db.query<LotListRow, []>(sql).all();

  return rows.map(mapLot);
}

// Лёгкая выборка партии для проверок (списание/доступ). Значения эффективные.
// null если партии нет или она аннулирована (voided-партии «нет»).
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
      `SELECT r.id                                   AS id,
              r.site_id                              AS site_id,
              s.name                                 AS site_name,
              COALESCE(cr.new_date, r.received_date) AS received_date,
              COALESCE(cr.new_unit, r.unit)          AS unit,
              COALESCE(cr.new_name, r.name)          AS name,
              COALESCE(cr.new_code, r.code)          AS code
         FROM receipts r
         JOIN sites s ON s.id = r.site_id
         ${RECEIPT_CORR_JOIN}
        WHERE r.id = ? AND ${RECEIPT_NOT_VOIDED}`,
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

// История партии: приход (kind='receipt'/'transfer_in') + все списания,
// включая voided (их qty НЕ входит в running). Значения событий ЭФФЕКТИВНЫЕ,
// скорректированные события несут поле correction с оригиналом и автором правки.
// balanceAfter — нарастающий остаток. Авторы из users БЕЗ фильтра is_active.
// Сортировка событий: по эффективной дате ASC, затем id ASC.
// null если партии нет или она аннулирована.
export function history(
  id: number,
): { lot: Lot; events: HistoryEvent[] } | null {
  const lotRow = db
    .query<LotListRow, [number]>(
      `${LIST_SELECT} WHERE r.id = ? AND ${RECEIPT_NOT_VOIDED}`,
    )
    .get(id);
  if (!lotRow) return null;

  const lot = mapLot(lotRow);

  // Действующая edit-корректировка прихода (void отфильтрован выше) + её автор
  // и оригинальные значения — для поля correction у события прихода.
  const rcptCorr = db
    .query<
      {
        corr_action: string;
        corr_date: string;
        corr_username: string | null;
        corr_display_name: string | null;
        orig_qty: number;
        orig_date: string;
        orig_name: string;
        orig_code: string;
        orig_unit: string;
      },
      [number]
    >(
      `SELECT
         cr.action        AS corr_action,
         cr.created_at    AS corr_date,
         cu.username      AS corr_username,
         cu.display_name  AS corr_display_name,
         r.qty_initial    AS orig_qty,
         r.received_date  AS orig_date,
         r.name           AS orig_name,
         r.code           AS orig_code,
         r.unit           AS orig_unit
       FROM receipts r
       ${RECEIPT_CORR_JOIN}
       LEFT JOIN users cu ON cu.id = cr.created_by
       WHERE r.id = ? AND cr.action = 'edit'`,
    )
    .get(id);

  // Списания (все, включая voided) с эффективными значениями и данными корректировки.
  // Сортировка: эффективная дата ASC, затем id ASC (стабильно по вставке).
  // LEFT JOIN transfers t_out — если списание это перемещение, поднимаем имя
  // целевого участка (to_receipt → sites). Тогда событие — transfer_out.
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
        transfer_site_name: string | null;
        corr_action: string | null;
        corr_qty: number | null;
        corr_date: string | null;
        corr_license_plate: string | null;
        corr_reason: string | null;
        corr_created_at: string | null;
        corr_username: string | null;
        corr_display_name: string | null;
      },
      [number]
    >(
      `SELECT
         w.id                 AS id,
         w.qty                AS qty,
         w.writeoff_date      AS writeoff_date,
         w.license_plate      AS license_plate,
         w.reason             AS reason,
         au.username          AS author_username,
         au.display_name      AS author_display_name,
         to_s.name            AS transfer_site_name,
         cw.action            AS corr_action,
         cw.new_qty           AS corr_qty,
         cw.new_date          AS corr_date,
         cw.new_license_plate AS corr_license_plate,
         cw.new_reason        AS corr_reason,
         cw.created_at        AS corr_created_at,
         cu.username          AS corr_username,
         cu.display_name      AS corr_display_name
       FROM writeoffs w
       LEFT JOIN users au ON au.id = w.created_by
       LEFT JOIN transfers t_out ON t_out.writeoff_id = w.id
       LEFT JOIN receipts to_r ON to_r.id = t_out.to_receipt_id
       LEFT JOIN sites to_s ON to_s.id = to_r.site_id
       ${WRITEOFF_CORR_JOIN}
       LEFT JOIN users cu ON cu.id = cw.created_by
       WHERE w.receipt_id = ?
       ORDER BY COALESCE(cw.new_date, w.writeoff_date) ASC, w.id ASC`,
    )
    .all(id);

  // Является ли ЭТА партия целью какого-то перемещения (to_receipt_id=id)?
  // Если да — первое событие партии = transfer_in, counterSiteName = исходный участок.
  const inRow = db
    .query<{ from_site_name: string }, [number]>(
      `SELECT from_s.name AS from_site_name
         FROM transfers t
         JOIN receipts from_r ON from_r.id = t.from_receipt_id
         JOIN sites from_s ON from_s.id = from_r.site_id
        WHERE t.to_receipt_id = ?
        LIMIT 1`,
    )
    .get(id);

  const events: HistoryEvent[] = [];

  // Первое событие — приход (нарастающий остаток стартует с эффективного initialQty).
  let running = lot.initialQty;
  // Автор прихода = автор партии (lot.author). Если приход правился — добавляем correction.
  const receiptCorrection: HistoryEvent["correction"] | undefined = rcptCorr
    ? {
        action: "edit",
        author: {
          username: rcptCorr.corr_username ?? "",
          displayName: rcptCorr.corr_display_name,
        },
        date: rcptCorr.corr_date.slice(0, 10),
        original: {
          qty: round3(rcptCorr.orig_qty),
          date: rcptCorr.orig_date,
          name: rcptCorr.orig_name,
          code: rcptCorr.orig_code,
          unit: rcptCorr.orig_unit,
        },
      }
    : undefined;

  events.push(
    inRow
      ? {
          kind: "transfer_in",
          date: lot.receivedDate,
          qty: lot.initialQty,
          balanceAfter: round3(running),
          counterSiteName: inRow.from_site_name,
          author: lot.author,
          ...(receiptCorrection ? { correction: receiptCorrection } : {}),
        }
      : {
          kind: "receipt",
          date: lot.receivedDate,
          qty: lot.initialQty,
          balanceAfter: round3(running),
          author: lot.author,
          ...(receiptCorrection ? { correction: receiptCorrection } : {}),
        },
  );

  for (const w of wos) {
    const voided = w.corr_action === "void";
    const edited = w.corr_action === "edit";
    // Эффективные значения: для voided — оригинал (в running не входит),
    // для edited — снапшот корректировки, иначе — оригинал.
    const qty = round3(voided ? w.qty : (w.corr_qty ?? w.qty));
    const date = voided ? w.writeoff_date : (w.corr_date ?? w.writeoff_date);
    const licensePlate = voided
      ? w.license_plate
      : (w.corr_license_plate ?? w.license_plate);
    const reason = voided ? w.reason : (w.corr_reason ?? w.reason);

    // Voided-списание остаток НЕ уменьшает.
    if (!voided) running = round3(running - qty);

    const author = {
      username: w.author_username ?? "",
      displayName: w.author_display_name,
    };
    const correction: HistoryEvent["correction"] | undefined =
      voided || edited
        ? {
            action: voided ? "void" : "edit",
            author: {
              username: w.corr_username ?? "",
              displayName: w.corr_display_name,
            },
            date: (w.corr_created_at ?? "").slice(0, 10),
            original: {
              qty: round3(w.qty),
              date: w.writeoff_date,
              licensePlate: w.license_plate,
              reason: w.reason,
            },
          }
        : undefined;

    if (w.transfer_site_name != null) {
      // Перемещение: № авто/причину не показываем, добавляем counterSiteName.
      events.push({
        kind: "transfer_out",
        date,
        qty,
        balanceAfter: running,
        counterSiteName: w.transfer_site_name,
        author,
        writeoffId: w.id,
        ...(correction ? { correction } : {}),
      });
    } else {
      events.push({
        kind: "writeoff",
        date,
        qty,
        balanceAfter: running,
        licensePlate,
        reason,
        author,
        writeoffId: w.id,
        ...(correction ? { correction } : {}),
      });
    }
  }

  // Финальный running после всех активных списаний совпадает с lot.balance (тот же round3/EPS).
  return { lot, events };
}
