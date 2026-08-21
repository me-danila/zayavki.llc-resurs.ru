// Репозиторий справочника инициаторов заявки (таблица initiators).
// Имя уникально; архив обратим (is_active 0↔1) — как у sites, физического удаления нет.

import { db } from "../db";
import type { Initiator } from "./types";

type InitiatorRow = {
  id: number;
  name: string;
  position: string;
  is_active: number;
};

function toInitiator(row: InitiatorRow): Initiator {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    active: row.is_active === 1,
  };
}

// Список. По умолчанию все (для админки); includeArchived:false — только активные
// (публичный GET /api/initiators для формы заявки).
export function list(opts?: { includeArchived?: boolean }): Initiator[] {
  const includeArchived = opts?.includeArchived ?? true;
  const where = includeArchived ? "" : "WHERE is_active = 1";
  return db
    .query<InitiatorRow, []>(
      `SELECT id, name, position, is_active FROM initiators ${where}
       ORDER BY is_active DESC, name COLLATE NOCASE`,
    )
    .all()
    .map(toInitiator);
}

// Проверка дубля имени регистронезависимо для ЛЮБОГО алфавита: SQLite COLLATE NOCASE
// фолдит только латиницу, поэтому кириллицу сверяем в JS (как в repo/sites.ts).
function nameTaken(name: string, exceptId?: number): boolean {
  const key = name.trim().toLowerCase();
  return db
    .query<{ id: number; name: string }, []>("SELECT id, name FROM initiators")
    .all()
    .some((r) => r.id !== exceptId && r.name.toLowerCase() === key);
}

export function create(
  input: { name: string; position: string },
  createdBy: number,
): { id: number } | { conflict: "exists" } {
  const name = input.name.trim();
  const position = input.position.trim();
  if (nameTaken(name)) return { conflict: "exists" };
  const res = db
    .query<{ id: number }, [string, string, number]>(
      "INSERT INTO initiators (name, position, created_by) VALUES (?, ?, ?) RETURNING id",
    )
    .get(name, position, createdBy)!;
  return { id: res.id };
}

// Правка ФИО и/или должности. Пустые поля отсекает слой выше.
export function update(
  id: number,
  patch: { name?: string; position?: string },
): { ok: true } | { ok: false; reason: "not_found" | "exists" } {
  const row = db
    .query<InitiatorRow, [number]>(
      "SELECT id, name, position, is_active FROM initiators WHERE id = ?",
    )
    .get(id);
  if (!row) return { ok: false, reason: "not_found" };

  const name = patch.name?.trim() ?? row.name;
  const position = patch.position?.trim() ?? row.position;
  if (name !== row.name && nameTaken(name, id)) {
    return { ok: false, reason: "exists" };
  }
  db.run("UPDATE initiators SET name = ?, position = ? WHERE id = ?", [
    name,
    position,
    id,
  ]);
  return { ok: true };
}

// Архивирование (is_active=1 → 0). Обратимо через restore; физически не удаляем,
// чтобы уже отправленные заявки сохраняли осмысленную историю.
export function archive(id: number): boolean {
  return db.run("UPDATE initiators SET is_active = 0 WHERE id = ?", [id]).changes > 0;
}

export function restore(id: number): boolean {
  return db.run("UPDATE initiators SET is_active = 1 WHERE id = ?", [id]).changes > 0;
}
