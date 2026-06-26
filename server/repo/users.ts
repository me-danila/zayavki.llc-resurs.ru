// Репозиторий пользователей. Пароли — только Bun.password (argon2id).
// Логин уникален (UNIQUE COLLATE NOCASE), реактивация воркера по старому логину разрешена.

import { db } from "../db";
import type { UserRow, WorkerListItem } from "./types";

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
    .query<UserRow, []>(
      "SELECT * FROM users WHERE role = 'worker' ORDER BY is_active DESC, username COLLATE NOCASE",
    )
    .all();
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    site: row.site,
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
  site: string;
  createdBy: number;
}): Promise<{ id: number } | { conflict: "active" }> {
  const { username, password, displayName, site, createdBy } = input;

  const existing = findByUsername(username);
  if (existing) {
    // Логин занят активным пользователем (воркером или менеджером) — конфликт.
    if (existing.is_active === 1) return { conflict: "active" };
    // Неактивный — реактивируем по тому же id. Хэшируем новый пароль.
    const hash = await Bun.password.hash(password);
    db.query<null, [string, string, string | null, number]>(
      `UPDATE users
         SET is_active = 1,
             password_hash = ?,
             site = ?,
             display_name = ?,
             role = 'worker'
       WHERE id = ?`,
    ).run(hash, site, displayName, existing.id);
    return { id: existing.id };
  }

  // Нового воркера создаём с argon2id-хэшем.
  const hash = await Bun.password.hash(password);
  const res = db
    .query<{ id: number }, [string, string, string, string | null, number]>(
      `INSERT INTO users (username, password_hash, role, site, display_name, created_by)
       VALUES (?, ?, 'worker', ?, ?, ?)
       RETURNING id`,
    )
    .get(username, hash, site, displayName, createdBy)!;
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
