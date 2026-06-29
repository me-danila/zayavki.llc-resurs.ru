// Сид пользователей: менеджеры + воркеры. Пароли НЕ хардкодим — только из env.
// Никаких встроенных дефолтных логинов/паролей: если env не задан, сид ничего не создаёт.
// Печатаем созданные логины БЕЗ паролей.
//
// Запуск:  bun run seed   (или  bun server/seed.ts)
//
// ── Конфигурация через env ───────────────────────────────────────────────────
// GSM_SEED_MANAGERS — список менеджеров, формат: "username:password:displayName"
//                     через запятую. Пароль можно не указывать в строке, если задан
//                     GSM_SEED_MANAGER_PASSWORD. displayName опционален.
// GSM_SEED_WORKERS  — список воркеров,   формат: "username:password:site:displayName"
//                     через запятую. Пароль — в строке или GSM_SEED_WORKER_PASSWORD.
// GSM_SEED_MANAGER_PASSWORD / GSM_SEED_WORKER_PASSWORD — пароль по умолчанию для строк,
//                     где он не указан явно.
//
// Если для записи нет пароля (ни в строке, ни в env) — запись ПРОПУСКАЕТСЯ с предупреждением.

import "dotenv/config";
import { db } from "./db";

type ManagerSeed = { username: string; password: string; displayName: string | null };
type WorkerSeed = {
  username: string;
  password: string;
  site: string;
  displayName: string | null;
};

const skippedNoPassword: string[] = [];

function managerPassword(explicit: string | undefined): string | null {
  if (explicit && explicit.trim()) return explicit;
  const env = process.env.GSM_SEED_MANAGER_PASSWORD;
  if (env && env.trim()) return env;
  return null;
}

function workerPassword(explicit: string | undefined): string | null {
  if (explicit && explicit.trim()) return explicit;
  const env = process.env.GSM_SEED_WORKER_PASSWORD;
  if (env && env.trim()) return env;
  return null;
}

// Парсинг "a:b:c" с учётом опциональных хвостов.
function parts(spec: string): string[] {
  return spec.split(":").map((s) => s.trim());
}

function parseManagers(): ManagerSeed[] {
  const raw = process.env.GSM_SEED_MANAGERS;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((spec) => {
      const [username, password, displayName] = parts(spec);
      return { username, password, displayName: displayName || null };
    })
    .filter((m) => m.username)
    .map((m) => {
      const password = managerPassword(m.password);
      if (!password) {
        skippedNoPassword.push(`${m.username} (менеджер)`);
        return null;
      }
      return { username: m.username, password, displayName: m.displayName };
    })
    .filter((m): m is ManagerSeed => m !== null);
}

function parseWorkers(): WorkerSeed[] {
  const raw = process.env.GSM_SEED_WORKERS;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((spec) => {
      const [username, password, site, displayName] = parts(spec);
      return { username, password, site, displayName: displayName || null };
    })
    .filter((w) => w.username && w.site)
    .map((w) => {
      const password = workerPassword(w.password);
      if (!password) {
        skippedNoPassword.push(`${w.username} (воркер)`);
        return null;
      }
      return { username: w.username, password, site: w.site, displayName: w.displayName };
    })
    .filter((w): w is WorkerSeed => w !== null);
}

// INSERT с ON CONFLICT(username) DO NOTHING — повторный сид не трогает существующих.
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

  console.log("=== Сид пользователей ГСМ ===");

  if (!managers.length && !workers.length && !skippedNoPassword.length) {
    console.warn(
      "[seed] Нечего сеять: задайте GSM_SEED_MANAGERS / GSM_SEED_WORKERS в env. " +
        "Встроенных дефолтных пользователей больше нет.",
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

  if (skippedNoPassword.length) {
    console.warn(
      "[seed] Пропущены без пароля (нет ни в строке, ни в GSM_SEED_*_PASSWORD): " +
        skippedNoPassword.join(", "),
    );
  }

  console.log("=== Готово ===");
}

main().catch((err) => {
  console.error("[seed] ошибка:", err);
  process.exit(1);
});
