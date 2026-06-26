// Сид пользователей: менеджеры + стартовые воркеры.
// Пароли НЕ хардкодим в коде — берём из process.env. Дефолт допустим только для локалки
// (с явным предупреждением). Печатаем созданные логины БЕЗ паролей.
//
// Запуск:  bun run seed   (или  bun server/seed.ts)
//
// ── Конфигурация через env ───────────────────────────────────────────────────
// GSM_SEED_MANAGERS — список менеджеров, формат: "username:password:displayName"
//                     через запятую. Пароль/displayName опциональны
//                     (пароль берётся из GSM_SEED_MANAGER_PASSWORD, иначе дефолт-локалка).
// GSM_SEED_WORKERS  — список воркеров,   формат: "username:password:site:displayName"
//                     через запятую. Пароль опционален (см. GSM_SEED_WORKER_PASSWORD).
// GSM_SEED_MANAGER_PASSWORD / GSM_SEED_WORKER_PASSWORD — дефолтный пароль для строк,
//                     где он не указан явно.
//
// Если env не заданы — используется встроенный список логинов с локальным дефолт-паролем
// (с предупреждением). Пароли в коде НЕ хранятся.

import "dotenv/config";
import { db } from "./db";

const LOCAL_DEFAULT_PASSWORD = "changeme123";

// Встроенный список логинов на случай отсутствия env (только логины, без паролей!).
const FALLBACK_MANAGERS = ["manager"];
const FALLBACK_WORKERS: Array<{ username: string; site: string }> = [
  { username: "nyagan", site: "Нягань" },
  { username: "muravlenko", site: "Муравленко" },
];

type ManagerSeed = { username: string; password: string; displayName: string | null };
type WorkerSeed = {
  username: string;
  password: string;
  site: string;
  displayName: string | null;
};

let usedLocalDefault = false;

function managerPasswordFallback(): string {
  const env = process.env.GSM_SEED_MANAGER_PASSWORD;
  if (env && env.trim()) return env;
  usedLocalDefault = true;
  return LOCAL_DEFAULT_PASSWORD;
}

function workerPasswordFallback(): string {
  const env = process.env.GSM_SEED_WORKER_PASSWORD;
  if (env && env.trim()) return env;
  usedLocalDefault = true;
  return LOCAL_DEFAULT_PASSWORD;
}

// Парсинг "a:b:c" с учётом опциональных хвостов. Пустые сегменты → undefined.
function parts(spec: string): string[] {
  return spec.split(":").map((s) => s.trim());
}

function parseManagers(): ManagerSeed[] {
  const raw = process.env.GSM_SEED_MANAGERS;
  if (raw && raw.trim()) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((spec) => {
        const [username, password, displayName] = parts(spec);
        return {
          username,
          password: password || managerPasswordFallback(),
          displayName: displayName || null,
        };
      })
      .filter((m) => m.username);
  }
  // Fallback: встроенные логины + дефолт-пароль.
  return FALLBACK_MANAGERS.map((username) => ({
    username,
    password: managerPasswordFallback(),
    displayName: null,
  }));
}

function parseWorkers(): WorkerSeed[] {
  const raw = process.env.GSM_SEED_WORKERS;
  if (raw && raw.trim()) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((spec) => {
        const [username, password, site, displayName] = parts(spec);
        return {
          username,
          password: password || workerPasswordFallback(),
          site,
          displayName: displayName || null,
        };
      })
      .filter((w) => w.username && w.site);
  }
  // Fallback: встроенные логины+участки + дефолт-пароль.
  return FALLBACK_WORKERS.map(({ username, site }) => ({
    username,
    password: workerPasswordFallback(),
    site,
    displayName: null,
  }));
}

// INSERT с ON CONFLICT(username) DO NOTHING — повторный сид не трогает существующих.
// Возвращает id вставленной строки либо null (конфликт → ничего не вставлено).
async function insertManager(m: ManagerSeed): Promise<number | null> {
  const hash = await Bun.password.hash(m.password);
  const row = db
    .query<{ id: number }, [string, string, string | null]>(
      `INSERT INTO users (username, password_hash, role, site, display_name)
       VALUES (?, ?, 'manager', NULL, ?)
       ON CONFLICT(username) DO NOTHING
       RETURNING id`,
    )
    .get(m.username, hash, m.displayName);
  return row ? row.id : null;
}

async function insertWorker(w: WorkerSeed): Promise<number | null> {
  const hash = await Bun.password.hash(w.password);
  const row = db
    .query<{ id: number }, [string, string, string, string | null]>(
      `INSERT INTO users (username, password_hash, role, site, display_name)
       VALUES (?, ?, 'worker', ?, ?)
       ON CONFLICT(username) DO NOTHING
       RETURNING id`,
    )
    .get(w.username, hash, w.site, w.displayName);
  return row ? row.id : null;
}

async function main() {
  const managers = parseManagers();
  const workers = parseWorkers();

  const createdManagers: string[] = [];
  const skippedManagers: string[] = [];
  const createdWorkers: string[] = [];
  const skippedWorkers: string[] = [];

  for (const m of managers) {
    const id = await insertManager(m);
    if (id !== null) createdManagers.push(m.username);
    else skippedManagers.push(m.username);
  }

  for (const w of workers) {
    const id = await insertWorker(w);
    if (id !== null) createdWorkers.push(`${w.username} (${w.site})`);
    else skippedWorkers.push(`${w.username} (${w.site})`);
  }

  // ── Печать итогов БЕЗ паролей ──────────────────────────────────────────────
  console.log("=== Сид пользователей ГСМ ===");
  if (usedLocalDefault) {
    console.warn(
      "[seed] ВНИМАНИЕ: использован локальный дефолт-пароль для части пользователей. " +
        "Для прода задайте GSM_SEED_MANAGER_PASSWORD / GSM_SEED_WORKER_PASSWORD " +
        "(или пароли прямо в GSM_SEED_MANAGERS/GSM_SEED_WORKERS).",
    );
  }

  console.log(
    `Менеджеры: создано ${createdManagers.length}, пропущено ${skippedManagers.length} (уже есть)`,
  );
  if (createdManagers.length) console.log("  + " + createdManagers.join(", "));
  if (skippedManagers.length) console.log("  = " + skippedManagers.join(", "));

  console.log(
    `Воркеры: создано ${createdWorkers.length}, пропущено ${skippedWorkers.length} (уже есть)`,
  );
  if (createdWorkers.length) console.log("  + " + createdWorkers.join(", "));
  if (skippedWorkers.length) console.log("  = " + skippedWorkers.join(", "));

  console.log("=== Готово ===");
}

main().catch((err) => {
  console.error("[seed] ошибка:", err);
  process.exit(1);
});
