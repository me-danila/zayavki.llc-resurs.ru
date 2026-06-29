// Репозиторий пользователей. Пароли — только Bun.password (argon2id).
// Логин уникален (UNIQUE COLLATE NOCASE), реактивация воркера по старому логину разрешена.

import { db } from "../db";
import type { User, UserRow, WorkerListItem } from "./types";
import { toUser } from "./types";

// Поиск по логину (регистронезависимо — COLLATE NOCASE на колонке).
// Возвращает сырую строку (нужен password_hash для verifyLogin) либо null.
export function findByUsername(username: string): UserRow | null {
  return db
    .query<UserRow, [string]>("SELECT * FROM users WHERE username = ?")
    .get(username);
}

export function getById(id: number): UserRow | null {
  return db
    .query<UserRow, [number]>("SELECT * FROM users WHERE id = ?")
    .get(id);
}

// Публичный User по id (с JOIN на sites для siteName). null если пользователя нет.
// siteName: NULL у менеджера (site_id IS NULL), имя участка у воркера.
export function getUserById(id: number): User | null {
  const row = db
    .query<UserRow & { site_name: string | null }, [number]>(
      `SELECT u.*, s.name AS site_name
         FROM users u
         LEFT JOIN sites s ON s.id = u.site_id
        WHERE u.id = ?`,
    )
    .get(id);
  if (!row) return null;
  return toUser(row, row.site_name);
}

// Проверка логина: находим активного пользователя и сверяем пароль argon2id.
// Возвращает сырую строку при успехе, иначе null. Неактивные не пускаем.
export async function verifyLogin(
  username: string,
  password: string,
): Promise<UserRow | null> {
  const row = findByUsername(username);
  if (!row || row.is_active !== 1) return null;
  const ok = await Bun.password.verify(password, row.password_hash);
  return ok ? row : null;
}

// Список ВСЕХ воркеров (активные + архивные) для админки менеджера.
// Сортировка: активные сверху (is_active=1 раньше 0), внутри — по username (NOCASE).
export function listWorkers(): WorkerListItem[] {
  const rows = db
    .query<
      {
        id: number;
        username: string;
        display_name: string | null;
        site_id: number | null;
        site_name: string | null;
        is_active: number;
      },
      []
    >(
      `SELECT u.id, u.username, u.display_name, u.site_id,
              s.name AS site_name, u.is_active
         FROM users u
         LEFT JOIN sites s ON s.id = u.site_id
        WHERE u.role = 'worker'
        ORDER BY u.is_active DESC, u.username COLLATE NOCASE`,
    )
    .all();
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    siteId: row.site_id,
    siteName: row.site_name,
    active: row.is_active === 1,
  }));
}

// Восстановление из архива: только воркеры, перевод is_active=0 → 1.
// true — если строка действительно затронута (worker найден).
export function restoreWorker(id: number): boolean {
  const res = db.run(
    "UPDATE users SET is_active = 1 WHERE id = ? AND role = 'worker'",
    [id],
  );
  return res.changes > 0;
}

// Создание/реактивация воркера.
// - активный логин занят            → { conflict: 'active' }
// - есть неактивный с таким логином  → реактивировать (is_active=1, новый хэш/site) → { id }
// - иначе                            → INSERT нового воркера → { id }
// Роль всегда форсится 'worker'.
export async function createOrReactivateWorker(input: {
  username: string;
  password: string;
  displayName: string | null;
  siteId: number;
  createdBy: number;
}): Promise<{ id: number } | { conflict: "active" }> {
  const { username, password, displayName, siteId, createdBy } = input;

  const existing = findByUsername(username);
  if (existing) {
    // Логин занят активным пользователем (воркером или менеджером) — конфликт.
    if (existing.is_active === 1) return { conflict: "active" };
    // Неактивный — реактивируем по тому же id. Хэшируем новый пароль.
    const hash = await Bun.password.hash(password);
    db.query<null, [string, number, string | null, number]>(
      `UPDATE users
         SET is_active = 1,
             password_hash = ?,
             site_id = ?,
             display_name = ?,
             role = 'worker'
       WHERE id = ?`,
    ).run(hash, siteId, displayName, existing.id);
    return { id: existing.id };
  }

  // Нового воркера создаём с argon2id-хэшем.
  const hash = await Bun.password.hash(password);
  const res = db
    .query<{ id: number }, [string, string, number, string | null, number]>(
      `INSERT INTO users (username, password_hash, role, site_id, display_name, created_by)
       VALUES (?, ?, 'worker', ?, ?, ?)
       RETURNING id`,
    )
    .get(username, hash, siteId, displayName, createdBy)!;
  return { id: res.id };
}

// Мягкое удаление: только воркеры, только перевод is_active=0.
// true — если строка действительно изменилась.
export function softDeleteWorker(id: number): boolean {
  const res = db.run(
    "UPDATE users SET is_active = 0 WHERE id = ? AND role = 'worker' AND is_active = 1",
    [id],
  );
  return res.changes > 0;
}
