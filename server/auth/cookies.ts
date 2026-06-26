// Cookie-слой авторизации ГСМ. Читаем cookie вручную из заголовка,
// ставим/чистим через res.cookie / res.clearCookie (есть в express, без cookie-parser).

import type { Response } from "express";

// Имя cookie сессии (канон §3).
export const SESSION_COOKIE = "gsm_sid";

// 30 дней в миллисекундах (Max-Age=2592000 c).
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 2592000000

// Парсинг заголовка Cookie в плоскую карту имя→значение.
// Терпим к пустому/битому заголовку: всегда возвращает объект.
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    const rawVal = part.slice(eq + 1).trim();
    let val = rawVal;
    try {
      val = decodeURIComponent(rawVal);
    } catch {
      // битый percent-encoding — оставляем как есть
    }
    out[key] = val;
  }
  return out;
}

// Выставить cookie сессии. Secure — только в production (за nginx HTTPS).
export function setSession(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_MS,
    secure: process.env.NODE_ENV === "production",
  });
}

// Снять cookie сессии (атрибуты должны совпадать с set, иначе браузер не удалит).
export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
}
