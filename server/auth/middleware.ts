// Middleware авторизации ГСМ.
// attachUser    — читает cookie gsm_sid, резолвит сессию, кладёт req.user (или оставляет undefined).
// requireAuth   — 401, если req.user не выставлен.
// requireManager — 403, если роль не 'manager'.
// Доверяем ТОЛЬКО серверу: role/site/автор берём из сессии, не из тела запроса (канон §3.4).

import type { Request, Response, NextFunction } from "express";
import * as sessions from "../repo/sessions";
import type { Permission, User } from "../repo/types";
import { canAccessSite, hasPermission } from "../repo/permissions";
import { parseCookies, SESSION_COOKIE } from "./cookies";

// Augment Express.Request — req.user доступен во всех роутерах после attachUser.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Достаёт пользователя из cookie-сессии. Никогда не блокирует — просто
// выставляет req.user либо оставляет undefined. Гард — отдельными middleware ниже.
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    const resolved = sessions.resolve(token);
    if (resolved) req.user = resolved.user;
  }
  next();
}

// Требует аутентификации. attachUser должен стоять раньше в цепочке.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

// Требует роль manager. Супер-админ проходит тоже: его права — надмножество
// менеджерских. Подразумевает requireAuth раньше (но безопасно и без него).
export function requireManager(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (req.user.role !== "manager" && req.user.role !== "superadmin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

// --- RBAC v5 ----------------------------------------------------------------

// Требует роль superadmin. Только он правит матрицу прав и справочник ролей доступа.
export function requireSuperadmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (req.user.role !== "superadmin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

// Требует конкретное право из матрицы. Супер-админ проходит всегда (права неявные).
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!hasPermission(req.user, permission)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}

// Гард операций ГСМ по участку: 403 forbidden_site, если участок вне области
// видимости пользователя. Сервер — единственный источник правды (канон §3.4).
export function assertSiteAllowed(
  req: Request,
  res: Response,
  siteId: number,
): boolean {
  if (canAccessSite(req.user!, siteId)) return true;
  res.status(403).json({ error: "forbidden_site" });
  return false;
}
