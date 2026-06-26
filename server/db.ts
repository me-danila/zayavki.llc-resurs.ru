import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname, isAbsolute, join } from "path";

// Путь к файлу БД: env GSM_DB_PATH или дефолт server/data/inventory.db
// (относительно process.cwd() — в Docker это /app, т.е. /app/server/data/inventory.db).
const DB_PATH = (() => {
  const raw = process.env.GSM_DB_PATH || join("server", "data", "inventory.db");
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
})();

// Директория под файл БД должна существовать до открытия соединения.
mkdirSync(dirname(DB_PATH), { recursive: true });

// Singleton-соединение.
export const db = new Database(DB_PATH, { create: true });

// PRAGMA при открытии соединения.
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('manager','worker')),
  site          TEXT,
  display_name  TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id),
  CHECK ((role='manager' AND site IS NULL) OR (role='worker' AND site IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receipts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site          TEXT NOT NULL,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'л',
  qty_initial   REAL NOT NULL CHECK (qty_initial > 0),
  -- Канон §2 даёт GLOB '____-__-__', но в SQLite GLOB '_' — литерал, а не wildcard,
  -- из-за чего шаблон отвергает любую реальную дату. Эквивалент по интенту (день YYYY-MM-DD,
  -- только цифры) — классы [0-9]. См. issues этапа 0.
  received_date TEXT NOT NULL CHECK (received_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS writeoffs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id    INTEGER NOT NULL REFERENCES receipts(id),
  qty           REAL NOT NULL CHECK (qty > 0),
  -- См. комментарий к receipts.received_date: GLOB-классы вместо нерабочего '____-__-__'.
  writeoff_date TEXT NOT NULL CHECK (writeoff_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  license_plate TEXT NOT NULL,
  reason        TEXT NOT NULL,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_site       ON users(site) WHERE site IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_site    ON receipts(site);
CREATE INDEX IF NOT EXISTS idx_receipts_cby     ON receipts(created_by);
CREATE INDEX IF NOT EXISTS idx_writeoffs_recpt  ON writeoffs(receipt_id);
CREATE INDEX IF NOT EXISTS idx_writeoffs_cby    ON writeoffs(created_by);

CREATE TRIGGER IF NOT EXISTS receipts_no_update  BEFORE UPDATE ON receipts  BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS receipts_no_delete  BEFORE DELETE ON receipts  BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS writeoffs_no_update BEFORE UPDATE ON writeoffs BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS writeoffs_no_delete BEFORE DELETE ON writeoffs BEGIN SELECT RAISE(ABORT,'append-only'); END;
`;

// Создаёт всю схему (таблицы, индексы, триггеры) и фиксирует версию схемы.
// Идемпотентно: всё через IF NOT EXISTS, повторный вызов безопасен.
export function bootstrap() {
  db.exec(DDL);

  const { user_version } = db
    .query<{ user_version: number }, []>("PRAGMA user_version")
    .get()!;

  if (user_version < SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}

// Выполняем bootstrap на импорте модуля.
bootstrap();
