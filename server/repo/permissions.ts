// Репозиторий RBAC: матрица прав (user_permissions) и доступы к участкам (user_sites).
// Канон: супер-админ имеет все права неявно (строк в user_permissions у него нет)
// и видит все участки; менеджер — только выданные; воркер — только свой users.site_id.

import { db } from "../db";
import type { Permission, User } from "./types";
import { ALL_PERMISSIONS } from "./types";

// --- Права -----------------------------------------------------------------

// Права конкретного пользователя из матрицы (без неявных прав супер-админа).
export function listPermissions(userId: number): Permission[] {
  return db
    .query<{ permission: Permission }, [number]>(
      "SELECT permission FROM user_permissions WHERE user_id = ? ORDER BY permission",
    )
    .all(userId)
    .map((r) => r.permission);
}

// Эффективные права: у супер-админа — все, у остальных — то, что в матрице.
export function effectivePermissions(user: User): Permission[] {
  if (user.role === "superadmin") return [...ALL_PERMISSIONS];
  return listPermissions(user.id);
}

export function hasPermission(user: User, permission: Permission): boolean {
  if (user.role === "superadmin") return true;
  const row = db
    .query<{ n: number }, [number, string]>(
      "SELECT COUNT(*) AS n FROM user_permissions WHERE user_id = ? AND permission = ?",
    )
    .get(user.id, permission)!;
  return row.n > 0;
}

// Полная замена набора прав пользователя (галочки в UI супер-админа).
// Вызывающий слой обязан проверить, что цель — менеджер (права выдаются только им).
export function setPermissions(
  userId: number,
  permissions: Permission[],
  grantedBy: number,
): void {
  const unique = [...new Set(permissions)].filter((p) =>
    ALL_PERMISSIONS.includes(p),
  );
  const del = db.query<null, [number]>(
    "DELETE FROM user_permissions WHERE user_id = ?",
  );
  const ins = db.query<null, [number, string, number]>(
    "INSERT OR IGNORE INTO user_permissions (user_id, permission, granted_by) VALUES (?, ?, ?)",
  );
  db.transaction(() => {
    del.run(userId);
    for (const p of unique) ins.run(userId, p, grantedBy);
  })();
}

// --- Доступ к участкам ------------------------------------------------------

// Явно выданные участки (строки user_sites). Для воркера таблица не используется.
export function listSiteIds(userId: number): number[] {
  return db
    .query<{ site_id: number }, [number]>(
      "SELECT site_id FROM user_sites WHERE user_id = ? ORDER BY site_id",
    )
    .all(userId)
    .map((r) => r.site_id);
}

// Полная замена набора участков пользователя. Несуществующие id игнорируются
// (FK отсекает их на INSERT — поэтому фильтруем заранее по таблице sites).
export function setSiteIds(
  userId: number,
  siteIds: number[],
  grantedBy: number,
): void {
  const valid = new Set(
    db
      .query<{ id: number }, []>("SELECT id FROM sites")
      .all()
      .map((r) => r.id),
  );
  const unique = [...new Set(siteIds)].filter((id) => valid.has(id));
  const del = db.query<null, [number]>(
    "DELETE FROM user_sites WHERE user_id = ?",
  );
  const ins = db.query<null, [number, number, number]>(
    "INSERT OR IGNORE INTO user_sites (user_id, site_id, granted_by) VALUES (?, ?, ?)",
  );
  db.transaction(() => {
    del.run(userId);
    for (const id of unique) ins.run(userId, id, grantedBy);
  })();
}

// Область видимости участков.
// - superadmin → null («все участки», отдельного фильтра не нужно)
// - worker     → [site_id] (или [] если участка нет)
// - manager    → выданные в user_sites (может быть пустым — тогда он не видит ничего)
export function allowedSiteIds(user: User): number[] | null {
  if (user.role === "superadmin") return null;
  if (user.role === "worker") return user.siteId != null ? [user.siteId] : [];
  return listSiteIds(user.id);
}

// Разрешён ли конкретный участок пользователю.
export function canAccessSite(user: User, siteId: number): boolean {
  const allowed = allowedSiteIds(user);
  return allowed === null || allowed.includes(siteId);
}
