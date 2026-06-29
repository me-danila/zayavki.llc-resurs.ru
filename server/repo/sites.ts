// Репозиторий участков (таблица sites). Управляемый CRUD: список/создание/архив/восстановление.
// Имя уникально COLLATE NOCASE. Архив обратим (is_active 0↔1).

import { db } from "../db";
import type { Site } from "./types";

// Порог "ненулевого остатка" партии (как в каноне §writeoff): больше EPS — остаток есть.
const EPS = 1e-9;

// Сырая строка sites (snake_case как в SQLite). Достаточно полей для маппинга в Site.
type SiteRow = {
  id: number;
  name: string;
  is_active: number;
};

function toSite(row: SiteRow): Site {
  return { id: row.id, name: row.name, active: row.is_active === 1 };
}

// Список участков. По умолчанию все (активные+архивные); includeArchived:false — только активные.
// Сортировка: активные сверху (is_active=1 раньше 0), внутри — по name (NOCASE).
export function list(opts?: { includeArchived?: boolean }): Site[] {
  const includeArchived = opts?.includeArchived ?? true;
  const where = includeArchived ? "" : "WHERE is_active = 1";
  const rows = db
    .query<SiteRow, []>(
      `SELECT id, name, is_active FROM sites ${where}
       ORDER BY is_active DESC, name COLLATE NOCASE`,
    )
    .all();
  return rows.map(toSite);
}

export function getById(id: number): Site | null {
  const row = db
    .query<SiteRow, [number]>(
      "SELECT id, name, is_active FROM sites WHERE id = ?",
    )
    .get(id);
  return row ? toSite(row) : null;
}

// Существует ли участок и активен ли он (is_active=1). Для валидации siteId в приходах/employees.
export function isActive(id: number): boolean {
  const row = db
    .query<{ is_active: number }, [number]>(
      "SELECT is_active FROM sites WHERE id = ?",
    )
    .get(id);
  return row?.is_active === 1;
}

// Создание участка. trim имени; пустое отсекается слоем выше (тут считаем непустым).
// Уникальность регистронезависимо для ЛЮБОГО алфавита: SQLite COLLATE NOCASE/lower()
// фолдят только латиницу, поэтому кириллицу сверяем в JS (Unicode-aware toLowerCase).
// UNIQUE-констрейнт на колонке остаётся бэкстопом для точных/латинских дублей.
export function create(
  name: string,
  createdBy: number,
): { id: number } | { conflict: "exists" } {
  const trimmed = name.trim();
  const key = trimmed.toLowerCase();
  const existing = db.query<{ name: string }, []>("SELECT name FROM sites").all();
  if (existing.some((s) => s.name.toLowerCase() === key)) {
    return { conflict: "exists" };
  }
  const res = db
    .query<{ id: number }, [string, number]>(
      `INSERT INTO sites (name, created_by) VALUES (?, ?) RETURNING id`,
    )
    .get(trimmed, createdBy)!;
  return { id: res.id };
}

// Архивирование участка (is_active=1 → 0). Обратимо через restore.
// Гарды: активный воркер с site_id=id → has_workers; партия с остатком>EPS → has_stock.
// Сначала проверяем воркеров, затем остаток (любой порядок допустим — важна конкретная причина).
export function archive(
  id: number,
):
  | { ok: true }
  | { ok: false; reason: "not_found" | "has_stock" | "has_workers" } {
  const site = db
    .query<{ is_active: number }, [number]>(
      "SELECT is_active FROM sites WHERE id = ?",
    )
    .get(id);
  if (!site) return { ok: false, reason: "not_found" };

  // Активный воркер, прикреплённый к участку.
  const worker = db
    .query<{ n: number }, [number]>(
      "SELECT COUNT(*) AS n FROM users WHERE site_id = ? AND role = 'worker' AND is_active = 1",
    )
    .get(id)!;
  if (worker.n > 0) return { ok: false, reason: "has_workers" };

  // Партия с ненулевым остатком: qty_initial - Σ(writeoffs) > EPS.
  const stock = db
    .query<{ n: number }, [number, number]>(
      `SELECT COUNT(*) AS n FROM receipts r
        WHERE r.site_id = ?
          AND r.qty_initial
              - COALESCE((SELECT SUM(w.qty) FROM writeoffs w WHERE w.receipt_id = r.id), 0)
              > ?`,
    )
    .get(id, EPS)!;
  if (stock.n > 0) return { ok: false, reason: "has_stock" };

  db.run("UPDATE sites SET is_active = 0 WHERE id = ?", [id]);
  return { ok: true };
}

// Восстановление из архива (is_active=0 → 1). true — если строка найдена и затронута.
export function restore(id: number): boolean {
  const res = db.run("UPDATE sites SET is_active = 1 WHERE id = ?", [id]);
  return res.changes > 0;
}
