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

const SCHEMA_VERSION = 7;

// Участки по умолчанию (бывший статичный LOTS) — засеваются при первом старте.
const DEFAULT_SITES = [
  "Нягань",
  "Муравленко",
  "Харампур",
  "Барсуки",
  "ЮНГ",
  "Офис",
];

// Базовая схема для СВЕЖИХ БД (актуальная, с site_id-FK). На существующих v1-БД
// CREATE ... IF NOT EXISTS — no-op, такие БД доводит миграция migrateToV2().
const BASE_DDL = `
CREATE TABLE IF NOT EXISTS sites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('superadmin','manager','worker')),
  site_id       INTEGER REFERENCES sites(id),
  display_name  TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id),
  CHECK ((role IN ('manager','superadmin') AND site_id IS NULL) OR (role='worker' AND site_id IS NOT NULL))
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
  site_id       INTEGER NOT NULL REFERENCES sites(id),
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'л',
  qty_initial   REAL NOT NULL CHECK (qty_initial > 0),
  -- Канон §2 даёт GLOB '____-__-__', но в SQLite GLOB '_' — литерал, а не wildcard.
  -- Эквивалент по интенту (день YYYY-MM-DD, только цифры) — классы [0-9].
  received_date TEXT NOT NULL CHECK (received_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS writeoffs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id    INTEGER NOT NULL REFERENCES receipts(id),
  qty           REAL NOT NULL CHECK (qty > 0),
  writeoff_date TEXT NOT NULL CHECK (writeoff_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  license_plate TEXT NOT NULL,
  reason        TEXT NOT NULL,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Индексы и триггеры — создаём ПОСЛЕ возможной миграции (rebuild дропает их вместе с таблицами).
const INDEXES_TRIGGERS_DDL = `
CREATE INDEX IF NOT EXISTS idx_users_site_id     ON users(site_id) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user     ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_site_id  ON receipts(site_id);
CREATE INDEX IF NOT EXISTS idx_receipts_cby      ON receipts(created_by);
CREATE INDEX IF NOT EXISTS idx_writeoffs_recpt   ON writeoffs(receipt_id);
CREATE INDEX IF NOT EXISTS idx_writeoffs_cby     ON writeoffs(created_by);

-- transfers: перемещение партии между участками (v3). Создаём после migrateToV2,
-- поэтому FK ссылаются на финальные receipts/writeoffs/users (в т.ч. для мигрированных v1-БД).
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_receipt_id INTEGER NOT NULL REFERENCES receipts(id),
  to_receipt_id   INTEGER NOT NULL REFERENCES receipts(id),
  writeoff_id     INTEGER NOT NULL REFERENCES writeoffs(id),
  qty REAL NOT NULL CHECK (qty > 0),
  transfer_date TEXT NOT NULL CHECK (transfer_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transfers_from     ON transfers(from_receipt_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to       ON transfers(to_receipt_id);
CREATE INDEX IF NOT EXISTS idx_transfers_writeoff ON transfers(writeoff_id);

-- corrections: отмена/правка записей менеджером (v4). Append-only сохраняется:
-- правка/отмена = НОВАЯ строка, никаких UPDATE receipts/writeoffs.
-- На одну запись может быть несколько корректировок; ДЕЙСТВУЕТ ПОСЛЕДНЯЯ
-- (max id per (target_kind, target_id)). action='void' — все new_* NULL.
-- action='edit' — repo/corrections.ts заполняет ВСЕ new_*-поля целевого типа
-- снапшотом итогового состояния, поэтому выборки смотрят только последнюю строку.
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('receipt','writeoff')),
  target_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('void','edit')),
  new_date TEXT CHECK (new_date IS NULL OR new_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  new_qty REAL CHECK (new_qty IS NULL OR new_qty > 0),
  new_name TEXT,
  new_code TEXT,
  new_unit TEXT,
  new_license_plate TEXT,
  new_reason TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_corrections_target ON corrections(target_kind, target_id);

CREATE TRIGGER IF NOT EXISTS receipts_no_update  BEFORE UPDATE ON receipts  BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS receipts_no_delete  BEFORE DELETE ON receipts  BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS writeoffs_no_update BEFORE UPDATE ON writeoffs BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS writeoffs_no_delete BEFORE DELETE ON writeoffs BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS transfers_no_update BEFORE UPDATE ON transfers BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS transfers_no_delete BEFORE DELETE ON transfers BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS corrections_no_update BEFORE UPDATE ON corrections BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS corrections_no_delete BEFORE DELETE ON corrections BEGIN SELECT RAISE(ABORT,'append-only'); END;
`;

// RBAC v5: участки-доступы, матрица прав, справочник инициаторов.
// Создаём ПОСЛЕ rebuild users (иначе FK повиснут на дропнутой таблице).
const RBAC_DDL = `
-- Доступ пользователя к участкам (many-to-many). Для менеджеров — область видимости
-- всех операций ГСМ; у воркера область по-прежнему одна: users.site_id.
CREATE TABLE IF NOT EXISTS user_sites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  granted_by INTEGER REFERENCES users(id),
  PRIMARY KEY (user_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sites_site ON user_sites(site_id);

-- Матрица прав. Право выдаётся ТОЛЬКО менеджеру и ТОЛЬКО супер-админом.
-- У супер-админа прав в таблице нет — все четыре подразумеваются неявно.
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('sites.manage','users.manage','access.manage','initiators.manage')),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  granted_by INTEGER REFERENCES users(id),
  PRIMARY KEY (user_id, permission)
);

-- Справочник инициаторов заявки (бывший хардкод src/data/initiatorData.tsx).
-- Архив обратим (is_active 0/1) — как у sites.
CREATE TABLE IF NOT EXISTS initiators (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  position   TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);
`;

// Начальный справочник инициаторов — перенос хардкода из src/data/initiatorData.tsx.
// Засевается ТОЛЬКО в пустую таблицу: удалённые админом записи не воскресают.
const DEFAULT_INITIATORS: Array<[string, string]> = [
  ["Коржавов Анатолиий Борисович", "Главный механик"],
  ["Редько Александр Сергеевич", "Механик"],
  ["Евсеев Сергей Петрович", "Механик"],
  ["Павлов Александр Васильевич", "Начальник участка"],
  ["Рейтер Василий Владимирович", "Механик"],
  ["Самсонов Александр Львович", "Механик"],
  ["Полуэктов Петр Витальевич", "Механик"],
  ["Волков Алексей Владимирович", "Механик"],
  ["Никулин Александр Викторович", "Механик"],
  ["Соболев Евгений Александрович", "Начальник участка"],
  ["Железнев Александр Геннадьевич", "Механик"],
  ["Сенников Александр Ильич", "Механик"],
  ["Ермилов Александр Николаевич", "Механик"],
  ["Жуковский Геннадий Павлович", "Механик"],
  ["Трубкин Иван Васильевич", "Механик"],
];

function seedInitiators() {
  const { n } = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM initiators")
    .get()!;
  if (n > 0) return;
  const ins = db.query<null, [string, string]>(
    "INSERT OR IGNORE INTO initiators (name, position) VALUES (?, ?)",
  );
  for (const [name, position] of DEFAULT_INITIATORS) ins.run(name, position);
}

// Миграция v6 → v7: колонка comment в расходе материалов.
// Чистый ALTER TABLE ADD COLUMN — данные не трогает, CHECK менять не нужно.
function migratePartIssueComment() {
  for (const [table, column] of [
    ["part_issues", "comment"],
    ["part_issue_corrections", "new_comment"],
  ] as const) {
    if (!hasColumn(table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
  }
}

// Миграция v4 → v5: роль 'superadmin' в CHECK таблицы users.
// SQLite не умеет ALTER CHECK — только rebuild таблицы (как в migrateToV2).
function migrateUsersRoleCheck() {
  const row = db
    .query<{ sql: string }, []>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
    )
    .get();
  if (!row || row.sql.includes("superadmin")) return; // уже v5

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE users_v5 (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('superadmin','manager','worker')),
        site_id       INTEGER REFERENCES sites(id),
        display_name  TEXT,
        is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        created_by    INTEGER REFERENCES users(id),
        CHECK ((role IN ('manager','superadmin') AND site_id IS NULL) OR (role='worker' AND site_id IS NOT NULL))
      );
      INSERT INTO users_v5 (id, username, password_hash, role, site_id, display_name, is_active, created_at, created_by)
        SELECT id, username, password_hash, role, site_id, display_name, is_active, created_at, created_by FROM users;
      DROP TABLE users;
      ALTER TABLE users_v5 RENAME TO users;
    `);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    db.exec("PRAGMA foreign_keys = ON");
    throw e;
  }
  db.exec("PRAGMA foreign_keys = ON");

  const violations = db
    .query<{ table: string }, []>("PRAGMA foreign_key_check")
    .all();
  if (violations.length) {
    throw new Error(
      `[db] миграция v5: нарушения FK после rebuild: ${JSON.stringify(violations)}`,
    );
  }
}

// Бэкфилл прав для УЖЕ СУЩЕСТВУЮЩИХ менеджеров (одноразово, при переходе на v5).
// До v5 любой менеджер мог вести участки и сотрудников и видел все участки —
// сохраняем это поведение, иначе прод после деплоя теряет функционал.
// initiators.manage НЕ выдаём: возможность новая, по умолчанию только у супер-админа.
function backfillManagerGrants() {
  db.exec(`
    INSERT OR IGNORE INTO user_permissions (user_id, permission)
      SELECT u.id, p.permission
        FROM users u
        CROSS JOIN (
          SELECT 'sites.manage' AS permission
          UNION ALL SELECT 'users.manage'
          UNION ALL SELECT 'access.manage'
        ) p
       WHERE u.role = 'manager';

    INSERT OR IGNORE INTO user_sites (user_id, site_id)
      SELECT u.id, s.id FROM users u CROSS JOIN sites s WHERE u.role = 'manager';
  `);
}

// Расход штучных материалов (v6). Полностью независим от учёта ГСМ: нет прихода,
// нет партий, нет остатков — только журнал выдач. Ни одна таблица ГСМ не затрагивается.
// Вносит ТОЛЬКО механик, дату ставит сервер (сегодня), участок берётся из сессии.
// Правки/отмена — менеджером, append-only через part_issue_corrections.
const PARTS_DDL = `
CREATE TABLE IF NOT EXISTS part_issues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id       INTEGER NOT NULL REFERENCES sites(id),
  -- День выдачи. Формат как в receipts/writeoffs: классы [0-9], т.к. в SQLite
  -- GLOB '_' — литерал, а не wildcard.
  issue_date    TEXT NOT NULL CHECK (issue_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  part_number   TEXT NOT NULL,
  name          TEXT NOT NULL,
  -- Штучные материалы: только целые количества.
  qty           INTEGER NOT NULL CHECK (qty > 0 AND qty = CAST(qty AS INTEGER)),
  license_plate TEXT NOT NULL,
  recipient     TEXT NOT NULL,
  -- Комментарий механика, необязателен (v7).
  comment       TEXT,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_part_issues_site_date ON part_issues(site_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_part_issues_part      ON part_issues(part_number);
CREATE INDEX IF NOT EXISTS idx_part_issues_plate     ON part_issues(license_plate);
CREATE INDEX IF NOT EXISTS idx_part_issues_cby       ON part_issues(created_by);

-- Корректировки расхода. Отдельно от corrections: у той CHECK на ('receipt','writeoff'),
-- а менять CHECK в SQLite можно только rebuild'ом боевой append-only таблицы.
-- Действует ПОСЛЕДНЯЯ корректировка (max id per target_id). action='void' — все new_* NULL.
-- action='edit' — снапшот ВСЕХ полей итогового состояния, поэтому выборкам
-- достаточно посмотреть одну последнюю строку.
CREATE TABLE IF NOT EXISTS part_issue_corrections (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id         INTEGER NOT NULL REFERENCES part_issues(id),
  action            TEXT NOT NULL CHECK (action IN ('void','edit')),
  new_date          TEXT CHECK (new_date IS NULL OR new_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  new_part_number   TEXT,
  new_name          TEXT,
  new_qty           INTEGER CHECK (new_qty IS NULL OR (new_qty > 0 AND new_qty = CAST(new_qty AS INTEGER))),
  new_license_plate TEXT,
  new_recipient     TEXT,
  new_comment       TEXT,
  created_by        INTEGER NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_part_corr_target ON part_issue_corrections(target_id);

CREATE TRIGGER IF NOT EXISTS part_issues_no_update BEFORE UPDATE ON part_issues BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS part_issues_no_delete BEFORE DELETE ON part_issues BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS part_corr_no_update BEFORE UPDATE ON part_issue_corrections BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS part_corr_no_delete BEFORE DELETE ON part_issue_corrections BEGIN SELECT RAISE(ABORT,'append-only'); END;
`;

function hasColumn(table: string, column: string): boolean {
  const cols = db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all();
  return cols.some((c) => c.name === column);
}

// Засеваем ТОЛЬКО пустую таблицу. Иначе переименованный (v5) или архивированный
// дефолтный участок воскресал бы дублем при каждом старте сервера.
function seedSites() {
  const { n } = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sites")
    .get()!;
  if (n > 0) return;
  const ins = db.query<null, [string]>(
    "INSERT OR IGNORE INTO sites (name) VALUES (?)",
  );
  for (const name of DEFAULT_SITES) ins.run(name);
}

// Миграция существующих v1-БД (site TEXT) на v2 (site_id FK).
// Rebuild таблиц users/receipts с маппингом имени участка в sites.id.
function migrateToV2() {
  const usersHasSite = hasColumn("users", "site");
  const receiptsHasSite = hasColumn("receipts", "site");
  if (!usersHasSite && !receiptsHasSite) return; // уже на v2-схеме

  // Засеять sites именами из существующих данных (на случай не-дефолтных участков).
  if (usersHasSite) {
    db.exec(
      "INSERT OR IGNORE INTO sites (name) SELECT DISTINCT site FROM users WHERE site IS NOT NULL AND site <> ''",
    );
  }
  if (receiptsHasSite) {
    db.exec(
      "INSERT OR IGNORE INTO sites (name) SELECT DISTINCT site FROM receipts WHERE site IS NOT NULL AND site <> ''",
    );
  }

  // FK выключаем на время rebuild (PRAGMA нельзя менять внутри транзакции).
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    if (usersHasSite) {
      db.exec(`
        CREATE TABLE users_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          role          TEXT NOT NULL CHECK (role IN ('manager','worker')),
          site_id       INTEGER REFERENCES sites(id),
          display_name  TEXT,
          is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          created_by    INTEGER REFERENCES users(id),
          CHECK ((role='manager' AND site_id IS NULL) OR (role='worker' AND site_id IS NOT NULL))
        );
        INSERT INTO users_new (id, username, password_hash, role, site_id, display_name, is_active, created_at, created_by)
          SELECT u.id, u.username, u.password_hash, u.role,
                 (SELECT s.id FROM sites s WHERE s.name = u.site COLLATE NOCASE),
                 u.display_name, u.is_active, u.created_at, u.created_by
          FROM users u;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
    }

    if (receiptsHasSite) {
      db.exec(`
        CREATE TABLE receipts_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id       INTEGER NOT NULL REFERENCES sites(id),
          name          TEXT NOT NULL,
          code          TEXT NOT NULL,
          unit          TEXT NOT NULL DEFAULT 'л',
          qty_initial   REAL NOT NULL CHECK (qty_initial > 0),
          received_date TEXT NOT NULL CHECK (received_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          created_by    INTEGER NOT NULL REFERENCES users(id),
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO receipts_new (id, site_id, name, code, unit, qty_initial, received_date, created_by, created_at)
          SELECT r.id,
                 (SELECT s.id FROM sites s WHERE s.name = r.site COLLATE NOCASE),
                 r.name, r.code, r.unit, r.qty_initial, r.received_date, r.created_by, r.created_at
          FROM receipts r;
        DROP TABLE receipts;
        ALTER TABLE receipts_new RENAME TO receipts;
      `);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    db.exec("PRAGMA foreign_keys = ON");
    throw e;
  }
  db.exec("PRAGMA foreign_keys = ON");

  // Проверка целостности FK после rebuild.
  const violations = db
    .query<{ table: string }, []>("PRAGMA foreign_key_check")
    .all();
  if (violations.length) {
    throw new Error(
      `[db] миграция v2: нарушения FK после rebuild: ${JSON.stringify(violations)}`,
    );
  }
}

// Создаёт всю схему (таблицы, индексы, триггеры), мигрирует старые БД, фиксирует версию.
// Идемпотентно: безопасно вызывать повторно.
export function bootstrap() {
  const { user_version: prevVersion } = db
    .query<{ user_version: number }, []>("PRAGMA user_version")
    .get()!;

  // 1. Базовые таблицы (свежие БД получают сразу v2-схему; существующие — без изменений).
  db.exec(BASE_DDL);
  // 2. Участки по умолчанию.
  seedSites();
  // 3. Миграция существующих v1-БД (site TEXT → site_id FK).
  migrateToV2();
  // 4. Миграция v4→v5: роль superadmin в CHECK users (rebuild таблицы).
  migrateUsersRoleCheck();
  // 5. RBAC-таблицы (user_sites / user_permissions / initiators) — после rebuild users.
  db.exec(RBAC_DDL);
  // 6. Справочник инициаторов (только в пустую таблицу).
  seedInitiators();
  // 7. Одноразовый бэкфилл прав существующим менеджерам при переходе на v5.
  if (prevVersion < SCHEMA_VERSION) backfillManagerGrants();
  // 8. Индексы и триггеры (после возможного rebuild таблиц).
  db.exec(INDEXES_TRIGGERS_DDL);
  // 9. Расход штучных материалов (v6) — аддитивно, существующие таблицы не трогает.
  db.exec(PARTS_DDL);
  // 10. v7: колонка comment у расхода материалов (ADD COLUMN, данные не трогает).
  migratePartIssueComment();

  if (prevVersion < SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}

// Выполняем bootstrap на импорте модуля.
bootstrap();
