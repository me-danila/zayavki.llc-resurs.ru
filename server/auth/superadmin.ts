// Бутстрап супер-админа из окружения.
// SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD (+ опционально SUPERADMIN_DISPLAY_NAME).
// Один и тот же .env локально и на проде → один и тот же аккаунт.
//
// Логика идемпотентна и выполняется при каждом старте:
//  - переменных нет            → пропуск (warn в лог)
//  - пользователя нет          → создаётся с role='superadmin'
//  - пользователь есть         → пароль пере-хэшируется, если в .env он изменился,
//                                строка реактивируется, ФИО подтягивается
//  - логин занят НЕ супер-админом → ошибка в лог, ничего не трогаем

import { db } from "../db";
import * as users from "../repo/users";

export async function bootstrapSuperadmin(): Promise<void> {
  const username = process.env.SUPERADMIN_USERNAME?.trim();
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!username || !password) {
    console.warn(
      "[superadmin] SUPERADMIN_USERNAME/SUPERADMIN_PASSWORD не заданы — аккаунт супер-админа не создан",
    );
    return;
  }
  if (password.length < 8) {
    console.error("[superadmin] SUPERADMIN_PASSWORD короче 8 символов — аккаунт не создан");
    return;
  }

  const displayName = process.env.SUPERADMIN_DISPLAY_NAME?.trim() || "Администратор";
  const existing = users.findByUsername(username);

  if (!existing) {
    const hash = await Bun.password.hash(password);
    db.run(
      `INSERT INTO users (username, password_hash, role, site_id, display_name)
       VALUES (?, ?, 'superadmin', NULL, ?)`,
      [username, hash, displayName],
    );
    console.log(`[superadmin] создан аккаунт «${username}»`);
    return;
  }

  if (existing.role !== "superadmin") {
    console.error(
      `[superadmin] логин «${username}» уже занят пользователем с ролью ${existing.role} — аккаунт супер-админа НЕ создан`,
    );
    return;
  }

  // Пароль в .env мог смениться — сверяем и пере-хэшируем только при расхождении,
  // чтобы не дёргать argon2id на каждом старте.
  const same = await Bun.password.verify(password, existing.password_hash);
  const hash = same ? existing.password_hash : await Bun.password.hash(password);
  db.run(
    `UPDATE users
        SET password_hash = ?, display_name = ?, is_active = 1, site_id = NULL, role = 'superadmin'
      WHERE id = ?`,
    [hash, displayName, existing.id],
  );
  if (!same) console.log(`[superadmin] пароль аккаунта «${username}» обновлён из .env`);
}
