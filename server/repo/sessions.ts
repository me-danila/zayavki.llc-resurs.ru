// Репозиторий сессий. Токен = значение cookie gsm_sid.
// Срок жизни — 30 дней, скользящее продление last_seen_at при resolve.

import { db } from "../db";
import type { User, UserRow } from "./types";
import { toUser } from "./types";

const THIRTY_DAYS = "+30 days";

// Создать сессию. Токен — криптослучайный (два UUID без дефисов = 64 hex).
export function create(userId: number): { token: string; expiresAt: string } {
  const token = (
    crypto.randomUUID() + crypto.randomUUID()
  ).replace(/-/g, "");
  const row = db
    .query<{ expires_at: string }, [string, number]>(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES (?, ?, datetime('now', '${THIRTY_DAYS}'))
       RETURNING expires_at`,
    )
    .get(token, userId)!;
  return { token, expiresAt: row.expires_at };
}

// Разрешить токен в пользователя.
// Условия: сессия не истекла (expires_at > now) И пользователь активен (is_active=1).
// Побочный эффект — скользящее продление last_seen_at.
// Возвращает { user } либо null.
export function resolve(token: string): { user: User } | null {
  const row = db
    .query<UserRow, [string]>(
      `SELECT u.*
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?
          AND s.expires_at > datetime('now')
          AND u.is_active = 1`,
    )
    .get(token);

  if (!row) return null;

  // Скользящее обновление last_seen_at. expires_at не двигаем (фиксированные 30 дней).
  db.run("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?", [
    token,
  ]);

  return { user: toUser(row) };
}

// Удалить конкретную сессию (logout).
export function destroy(token: string): void {
  db.run("DELETE FROM sessions WHERE id = ?", [token]);
}

// Чистка протухших сессий (можно дёргать по расписанию/на логине).
export function cleanupExpired(): number {
  const res = db.run(
    "DELETE FROM sessions WHERE expires_at <= datetime('now')",
  );
  return res.changes;
}
