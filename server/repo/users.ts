// Репозиторий пользователей. Пароли — только Bun.password (argon2id).
// Логин уникален (UNIQUE COLLATE NOCASE), реактивация воркера по старому логину разрешена.

import { db } from "../db";
import type { Role, User, UserListItem, UserRow, WorkerListItem } from "./types";
import { toUser } from "./types";
import { listPermissions, listSiteIds } from "./permissions";

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

// --- RBAC v5: администрирование пользователей ------------------------------

// Список пользователей для админки (все роли).
// scopeSiteIds=null — без ограничения (супер-админ). Иначе показываем только тех,
// кто связан с этими участками: воркеров по users.site_id, менеджеров по user_sites.
// Супер-админы видны только супер-админу (scopeSiteIds=null).
export function listUsers(scopeSiteIds: number[] | null): UserListItem[] {
  const rows = db
    .query<
      {
        id: number;
        username: string;
        display_name: string | null;
        role: Role;
        site_id: number | null;
        site_name: string | null;
        is_active: number;
      },
      []
    >(
      `SELECT u.id, u.username, u.display_name, u.role, u.site_id,
              s.name AS site_name, u.is_active
         FROM users u
         LEFT JOIN sites s ON s.id = u.site_id
        ORDER BY u.is_active DESC,
                 CASE u.role WHEN 'superadmin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
                 u.username COLLATE NOCASE`,
    )
    .all();

  const scope = scopeSiteIds === null ? null : new Set(scopeSiteIds);

  return rows
    .filter((row) => {
      if (scope === null) return true;
      if (row.role === "superadmin") return false;
      if (row.role === "worker") {
        return row.site_id != null && scope.has(row.site_id);
      }
      return listSiteIds(row.id).some((id) => scope.has(id));
    })
    .map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      siteId: row.site_id,
      siteName: row.site_name,
      active: row.is_active === 1,
      permissions: row.role === "manager" ? listPermissions(row.id) : [],
      siteIds: row.role === "manager" ? listSiteIds(row.id) : [],
    }));
}

// Создание/реактивация менеджера. Симметрично createOrReactivateWorker,
// но site_id всегда NULL (область менеджера задаётся таблицей user_sites).
export async function createOrReactivateManager(input: {
  username: string;
  password: string;
  displayName: string | null;
  createdBy: number;
}): Promise<{ id: number } | { conflict: "active" }> {
  const { username, password, displayName, createdBy } = input;

  const existing = findByUsername(username);
  if (existing) {
    if (existing.is_active === 1) return { conflict: "active" };
    // Супер-админа никогда не понижаем до менеджера через реактивацию логина.
    if (existing.role === "superadmin") return { conflict: "active" };
    const hash = await Bun.password.hash(password);
    db.query<null, [string, string | null, number]>(
      `UPDATE users
         SET is_active = 1,
             password_hash = ?,
             site_id = NULL,
             display_name = ?,
             role = 'manager'
       WHERE id = ?`,
    ).run(hash, displayName, existing.id);
    return { id: existing.id };
  }

  const hash = await Bun.password.hash(password);
  const res = db
    .query<{ id: number }, [string, string, string | null, number]>(
      `INSERT INTO users (username, password_hash, role, site_id, display_name, created_by)
       VALUES (?, ?, 'manager', NULL, ?, ?)
       RETURNING id`,
    )
    .get(username, hash, displayName, createdBy)!;
  return { id: res.id };
}

// Правка сотрудника: ФИО, участок (только для воркера) и/или сброс пароля.
// Супер-админ не редактируется через API — он живёт в .env.
export async function updateUser(
  id: number,
  patch: { displayName?: string | null; siteId?: number; password?: string },
): Promise<
  { ok: true } | { ok: false; reason: "not_found" | "site_not_allowed_for_role" }
> {
  const row = getById(id);
  if (!row || row.role === "superadmin") return { ok: false, reason: "not_found" };
  if (patch.siteId !== undefined && row.role !== "worker") {
    return { ok: false, reason: "site_not_allowed_for_role" };
  }

  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (patch.displayName !== undefined) {
    sets.push("display_name = ?");
    args.push(patch.displayName);
  }
  if (patch.siteId !== undefined) {
    sets.push("site_id = ?");
    args.push(patch.siteId);
  }
  if (patch.password !== undefined) {
    sets.push("password_hash = ?");
    args.push(await Bun.password.hash(patch.password));
  }
  if (!sets.length) return { ok: true };

  args.push(id);
  db.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, args);
  return { ok: true };
}

// Мягкое удаление любого сотрудника (менеджер или воркер), кроме супер-админа.
export function softDeleteUser(id: number): boolean {
  return (
    db.run(
      "UPDATE users SET is_active = 0 WHERE id = ? AND role IN ('manager','worker') AND is_active = 1",
      [id],
    ).changes > 0
  );
}

// Восстановление из архива любого сотрудника, кроме супер-админа.
export function restoreUser(id: number): boolean {
  return (
    db.run(
      "UPDATE users SET is_active = 1 WHERE id = ? AND role IN ('manager','worker')",
      [id],
    ).changes > 0
  );
}
