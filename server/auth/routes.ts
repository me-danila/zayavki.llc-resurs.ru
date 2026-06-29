// Роутер авторизации ГСМ: /api/gsm/login, /logout, /me.
// Монтируется в index.ts ПЕРЕД статикой. attachUser должен стоять выше по цепочке
// (на /api/gsm), чтобы /logout и /me видели req.user.

import { Router, type Request, type Response } from "express";
import * as users from "../repo/users";
import * as sessions from "../repo/sessions";
import { toUser } from "../repo/types";
import { setSession, clearSession, parseCookies, SESSION_COOKIE } from "./cookies";
import { requireAuth } from "./middleware";
import { loginLimiter, registerFailure, resetFailures } from "./rateLimit";

export const authRouter = Router();

// Ключ rate-limit: логин + IP. trust proxy в index.ts → req.ip учитывает X-Forwarded-For.
function limiterKey(username: string, req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `${username.toLowerCase()}|${ip}`;
}

// POST /api/gsm/login — публичный. rate-limit → verifyLogin → сессия + cookie.
authRouter.post("/api/gsm/login", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    res.status(400).json({ error: "bad_request" });
    return;
  }

  const key = limiterKey(username, req);
  if (!loginLimiter(key)) {
    res.status(429).json({ error: "too_many_requests" });
    return;
  }

  const row = await users.verifyLogin(username, password);
  if (!row) {
    registerFailure(key);
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  resetFailures(key);
  const { token } = sessions.create(row.id);
  setSession(res, token);
  // siteName берём JOIN sites (getUserById): null у менеджера, имя участка у воркера.
  res.status(200).json({ user: users.getUserById(row.id) ?? toUser(row, null) });
});

// POST /api/gsm/logout — auth. Удаляет сессию (если есть) + чистит cookie. Всегда 204.
authRouter.post("/api/gsm/logout", requireAuth, (req: Request, res: Response) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) sessions.destroy(token);
  clearSession(res);
  res.status(204).end();
});

// GET /api/gsm/me — auth. Текущий пользователь из сессии.
authRouter.get("/api/gsm/me", requireAuth, (req: Request, res: Response) => {
  res.status(200).json({ user: req.user });
});
