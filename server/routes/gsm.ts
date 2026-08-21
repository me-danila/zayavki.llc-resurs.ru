// API товароучёта ГСМ (Этап 3). Префикс /api/gsm, JSON, фронт credentials:'include'.
// attachUser смонтирован выше по цепочке (index.ts на /api/gsm), req.user — из сессии.
// login/logout/me живут в server/auth/routes.ts (Этап 2) — здесь не дублируем.
// Доверяем ТОЛЬКО серверу: role/site/автор берём из req.user, не из тела (канон §3.4).
// Чужой :id (партия другого участка) → 404, не 403 (не раскрываем существование).

import { Router, type Request, type Response } from "express";
import {
  assertSiteAllowed,
  requireAuth,
  requireManager,
  requirePermission,
  requireSuperadmin,
} from "../auth/middleware";
import * as lots from "../repo/lots";
import * as receipts from "../repo/receipts";
import * as writeoffs from "../repo/writeoffs";
import * as users from "../repo/users";
import * as sites from "../repo/sites";
import * as transfers from "../repo/transfers";
import * as corrections from "../repo/corrections";
import * as permissions from "../repo/permissions";
import * as initiators from "../repo/initiators";
import * as partIssues from "../repo/partIssues";
import { createPartIssuesXlsx } from "../services/partIssuesXlsx";
import type { Permission } from "../repo/types";
import { ALL_PERMISSIONS } from "../repo/types";
import { isValidDate, todayMsk } from "../lib/dates";

export const gsmRouter = Router();

// Парсинг :id в положительное целое. NaN/<=0 → null (трактуем как not_found).
function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

// v5: может ли текущий пользователь администрировать сотрудника targetId.
// Супер-админ — кого угодно, кроме себя же. Менеджер с users.manage — только тех,
// кто связан с его участками; супер-админа не трогает никто. Отказ маскируем 404,
// чтобы не раскрывать существование чужих учёток (единая конвенция роутов).
function canManageUser(req: Request, res: Response, targetId: number): boolean {
  const actor = req.user!;
  const target = users.getById(targetId);
  if (!target || target.role === "superadmin" || target.id === actor.id) {
    res.status(404).json({ error: "not_found" });
    return false;
  }
  const allowed = permissions.allowedSiteIds(actor);
  if (allowed === null) return true;

  const targetSites =
    target.role === "worker"
      ? target.site_id != null
        ? [target.site_id]
        : []
      : permissions.listSiteIds(target.id);
  if (!targetSites.some((id) => allowed.includes(id))) {
    res.status(404).json({ error: "not_found" });
    return false;
  }
  return true;
}

// GET /api/gsm/sites — manager. Участки в области видимости (активные сверху + архивные).
// v5: менеджер видит только выданные ему участки (user_sites), супер-админ — все.
gsmRouter.get(
  "/api/gsm/sites",
  requireAuth,
  requireManager,
  (req: Request, res: Response): void => {
    const onlyIds = permissions.allowedSiteIds(req.user!);
    res
      .status(200)
      .json({ sites: sites.list({ includeArchived: true, onlyIds }) });
  },
);

// GET /api/gsm/sites/active — auth (worker + manager). Только активные участки.
// Нужен для выпадашки целевого участка перемещения у ОБЕИХ ролей
// (воркеру /api/gsm/sites под requireManager недоступен).
gsmRouter.get(
  "/api/gsm/sites/active",
  requireAuth,
  (req: Request, res: Response): void => {
    const onlyIds = permissions.allowedSiteIds(req.user!);
    res
      .status(200)
      .json({ sites: sites.list({ includeArchived: false, onlyIds }) });
  },
);

// POST /api/gsm/sites — manager. Создание участка. {name} → 201 {id}.
// Пустое/непстрока → 400 invalid; дубликат NOCASE → 409 exists.
gsmRouter.post(
  "/api/gsm/sites",
  requireAuth,
  requirePermission("sites.manage"),
  (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "invalid" });
      return;
    }

    const result = sites.create(name, req.user!.id);
    if ("conflict" in result) {
      res.status(409).json({ error: "exists" });
      return;
    }
    // Менеджер обязан сразу видеть созданный им участок — иначе он пропадёт
    // из его области видимости. У супер-админа доступ ко всем участкам неявный.
    if (req.user!.role === "manager") {
      permissions.setSiteIds(
        req.user!.id,
        [...permissions.listSiteIds(req.user!.id), result.id],
        req.user!.id,
      );
    }
    res.status(201).json({ id: result.id });
  },
);

// POST /api/gsm/sites/:id/archive — manager. Архивирование (is_active=0).
// not_found → 404; активный воркер → 409 has_workers; остаток>EPS → 409 has_stock.
gsmRouter.post(
  "/api/gsm/sites/:id/archive",
  requireAuth,
  requirePermission("sites.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!assertSiteAllowed(req, res, id)) return;

    const result = sites.archive(id);
    if (result.ok) {
      res.status(204).end();
      return;
    }

    switch (result.reason) {
      case "not_found":
        res.status(404).json({ error: "not_found" });
        return;
      case "has_workers":
        res.status(409).json({ error: "has_workers" });
        return;
      case "has_stock":
        res.status(409).json({ error: "has_stock" });
        return;
    }
  },
);

// POST /api/gsm/sites/:id/restore — manager. Восстановление из архива (is_active=1).
gsmRouter.post(
  "/api/gsm/sites/:id/restore",
  requireAuth,
  requirePermission("sites.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!assertSiteAllowed(req, res, id)) return;

    const ok = sites.restore(id);
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  },
);

// PATCH /api/gsm/sites/:id — право sites.manage. Переименование участка.
// {name} → 204; пустое → 400 invalid; дубликат → 409 exists; нет участка → 404.
gsmRouter.patch(
  "/api/gsm/sites/:id",
  requireAuth,
  requirePermission("sites.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!assertSiteAllowed(req, res, id)) return;

    const body = (req.body ?? {}) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "invalid" });
      return;
    }

    const result = sites.rename(id, name);
    if (result.ok) {
      res.status(204).end();
      return;
    }
    res.status(result.reason === "exists" ? 409 : 404).json({
      error: result.reason,
    });
  },
);

// GET /api/gsm/lots — auth.
// manager: все партии; worker: сервер фильтрует по session.siteId (query игнорируем).
gsmRouter.get(
  "/api/gsm/lots",
  requireAuth,
  (req: Request, res: Response): void => {
    const user = req.user!;
    // Воркер — только свой участок; менеджер — выданные ему (v5); супер-админ — все.
    const allowed = permissions.allowedSiteIds(user);
    const list =
      user.role === "worker"
        ? lots.list({ siteId: user.siteId ?? 0 })
        : lots.list(allowed === null ? {} : { siteIds: allowed });
    res.status(200).json({ lots: list });
  },
);

// POST /api/gsm/receipts — manager. Мульти-приход одной транзакцией.
// Тело: {rows:[{receivedDate,siteId,name,code,unit?,quantity}]}.
gsmRouter.post(
  "/api/gsm/receipts",
  requireAuth,
  requireManager,
  (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as { rows?: unknown };
    const rows = body.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "empty_rows" });
      return;
    }

    const parsed: receipts.ReceiptInput[] = [];

    for (const raw of rows as unknown[]) {
      if (!raw || typeof raw !== "object") {
        res.status(400).json({ error: "invalid_row" });
        return;
      }
      const r = raw as {
        receivedDate?: unknown;
        siteId?: unknown;
        name?: unknown;
        code?: unknown;
        unit?: unknown;
        quantity?: unknown;
      };

      const siteId =
        typeof r.siteId === "number" ? r.siteId : Number(r.siteId);
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const code = typeof r.code === "string" ? r.code.trim() : "";
      const receivedDate =
        typeof r.receivedDate === "string" ? r.receivedDate : "";
      const unit =
        typeof r.unit === "string" && r.unit.trim() ? r.unit.trim() : undefined;
      const quantity =
        typeof r.quantity === "number" ? r.quantity : Number(r.quantity);

      // siteId должен быть существующим АКТИВНЫМ участком.
      if (!Number.isInteger(siteId) || siteId <= 0 || !sites.isActive(siteId)) {
        res.status(400).json({ error: "invalid_site" });
        return;
      }
      // ...и находиться в области видимости пользователя (v5).
      if (!assertSiteAllowed(req, res, siteId)) return;
      if (!name) {
        res.status(400).json({ error: "invalid_name" });
        return;
      }
      if (!code) {
        res.status(400).json({ error: "invalid_code" });
        return;
      }
      if (!isValidDate(receivedDate)) {
        res.status(400).json({ error: "invalid_date" });
        return;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        res.status(400).json({ error: "invalid_quantity" });
        return;
      }

      parsed.push({ receivedDate, siteId, name, code, unit, quantity });
    }

    try {
      const { created } = receipts.createMany(parsed, req.user!.id);
      res.status(201).json({ created });
    } catch {
      // Любой сбой валидации/вставки в репо — 400 (тело прошло поверхностную проверку).
      res.status(400).json({ error: "invalid_receipts" });
    }
  },
);

// POST /api/gsm/lots/:id/writeoffs — worker-only.
// Тело: {rows:[{date,licensePlate,amount,reason}]}. Серия в BEGIN IMMEDIATE.
// Менеджер сюда писать не должен — 403.
gsmRouter.post(
  "/api/gsm/lots/:id/writeoffs",
  requireAuth,
  (req: Request, res: Response): void => {
    const user = req.user!;
    // Списание — только воркер своего участка. Менеджер → 403 (не worker).
    if (user.role !== "worker" || user.siteId == null) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const body = (req.body ?? {}) as { rows?: unknown };
    const rawRows = body.rows;
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      res.status(400).json({ error: "empty_rows" });
      return;
    }

    const rows: writeoffs.WriteOffInput[] = [];
    for (const raw of rawRows as unknown[]) {
      if (!raw || typeof raw !== "object") {
        res.status(400).json({ error: "invalid_row" });
        return;
      }
      const r = raw as {
        date?: unknown;
        licensePlate?: unknown;
        amount?: unknown;
        reason?: unknown;
      };
      const date = typeof r.date === "string" ? r.date : "";
      const licensePlate =
        typeof r.licensePlate === "string" ? r.licensePlate : "";
      const reason = typeof r.reason === "string" ? r.reason : "";
      const amount =
        typeof r.amount === "number" ? r.amount : Number(r.amount);
      rows.push({ date, licensePlate, amount, reason });
    }

    const result = writeoffs.createSeries(id, rows, {
      id: user.id,
      siteId: user.siteId,
    });

    if (result.ok) {
      res.status(201).json({ created: result.created });
      return;
    }

    switch (result.error) {
      case "not_found":
        res.status(404).json({ error: "not_found" });
        return;
      case "date":
        res.status(400).json({ error: "date" });
        return;
      case "exceeds":
        res.status(409).json({ error: "exceeds", balance: result.balance });
        return;
    }
  },
);

// POST /api/gsm/lots/:id/transfer — auth (worker + manager).
// Тело: {toSiteId,qty,date}. Перемещение партии :id на другой активный участок.
// Воркер: исходная партия должна быть его участка (иначе 404). Менеджер: любая.
// Маппинг ошибок: not_found/forbidden → 404; same_site/inactive_site/date → 400;
// exceeds → 409 {error,balance}; ok → 201 {toReceiptId}.
gsmRouter.post(
  "/api/gsm/lots/:id/transfer",
  requireAuth,
  (req: Request, res: Response): void => {
    const user = req.user!;
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const body = (req.body ?? {}) as {
      toSiteId?: unknown;
      qty?: unknown;
      date?: unknown;
    };
    const toSiteId =
      typeof body.toSiteId === "number" ? body.toSiteId : Number(body.toSiteId);
    const qty = typeof body.qty === "number" ? body.qty : Number(body.qty);
    const date = typeof body.date === "string" ? body.date : "";

    // v5: исходная партия вне области видимости — маскируем под 404 (как чужой :id),
    // недоступный целевой участок — явный 403 forbidden_site.
    const sourceLot = lots.getById(id);
    if (sourceLot && !permissions.canAccessSite(user, sourceLot.siteId)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (Number.isInteger(toSiteId) && !assertSiteAllowed(req, res, toSiteId)) {
      return;
    }

    const result = transfers.create(id, toSiteId, qty, date, {
      id: user.id,
      role: user.role,
      siteId: user.siteId,
    });

    if (result.ok) {
      res.status(201).json({ toReceiptId: result.toReceiptId });
      return;
    }

    switch (result.error) {
      case "not_found":
      case "forbidden":
        res.status(404).json({ error: "not_found" });
        return;
      case "same_site":
      case "inactive_site":
      case "date":
        res.status(400).json({ error: result.error });
        return;
      case "exceeds":
        res.status(409).json({ error: "exceeds", balance: result.balance });
        return;
    }
  },
);

// POST /api/gsm/writeoffs/:id/correct — manager. Отмена/правка списания (v4).
// Тело: {action:'void'} | {action:'edit', date?, amount?, licensePlate?, reason?}.
// Маппинг: not_found→404; transfer_locked/already_voided→409;
// exceeds→409 {error,balance}; invalid→400; ok→201 {id}.
gsmRouter.post(
  "/api/gsm/writeoffs/:id/correct",
  requireAuth,
  requireManager,
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const body = (req.body ?? {}) as {
      action?: unknown;
      date?: unknown;
      amount?: unknown;
      licensePlate?: unknown;
      reason?: unknown;
    };

    let input: corrections.WriteoffCorrectionInput;
    if (body.action === "void") {
      input = { action: "void" };
    } else if (body.action === "edit") {
      // Передаём только присланные поля; кривые типы репо отвергнет как invalid.
      input = { action: "edit" };
      if (body.date !== undefined) {
        input.date = typeof body.date === "string" ? body.date : "";
      }
      if (body.amount !== undefined) {
        input.amount =
          typeof body.amount === "number" ? body.amount : Number(body.amount);
      }
      if (body.licensePlate !== undefined) {
        input.licensePlate =
          typeof body.licensePlate === "string" ? body.licensePlate : "";
      }
      if (body.reason !== undefined) {
        input.reason = typeof body.reason === "string" ? body.reason : "";
      }
    } else {
      res.status(400).json({ error: "invalid" });
      return;
    }

    // v5: списание чужого участка — 404 (не раскрываем существование).
    const woSiteId = lots.siteIdOfWriteoff(id);
    if (woSiteId !== null && !permissions.canAccessSite(req.user!, woSiteId)) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const result = corrections.correctWriteoff(id, input, req.user!.id);
    if (result.ok) {
      res.status(201).json({ id: result.id });
      return;
    }

    switch (result.error) {
      case "not_found":
        res.status(404).json({ error: "not_found" });
        return;
      case "transfer_locked":
        res.status(409).json({ error: "transfer_locked" });
        return;
      case "already_voided":
        res.status(409).json({ error: "already_voided" });
        return;
      case "exceeds":
        res.status(409).json({ error: "exceeds", balance: result.balance });
        return;
      case "invalid":
        res.status(400).json({ error: "invalid" });
        return;
    }
  },
);

// POST /api/gsm/receipts/:id/correct — manager. Отмена/правка прихода (партии) (v4).
// Тело: {action:'void'} | {action:'edit', receivedDate?, name?, code?, unit?, quantity?}.
// Участок партии НЕ меняется. Маппинг: not_found→404;
// transfer_locked/already_voided/has_writeoffs→409; exceeds→409 {error,balance};
// invalid→400; ok→201 {id}.
gsmRouter.post(
  "/api/gsm/receipts/:id/correct",
  requireAuth,
  requireManager,
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const body = (req.body ?? {}) as {
      action?: unknown;
      receivedDate?: unknown;
      name?: unknown;
      code?: unknown;
      unit?: unknown;
      quantity?: unknown;
    };

    let input: corrections.ReceiptCorrectionInput;
    if (body.action === "void") {
      input = { action: "void" };
    } else if (body.action === "edit") {
      // Передаём только присланные поля; кривые типы репо отвергнет как invalid.
      input = { action: "edit" };
      if (body.receivedDate !== undefined) {
        input.receivedDate =
          typeof body.receivedDate === "string" ? body.receivedDate : "";
      }
      if (body.name !== undefined) {
        input.name = typeof body.name === "string" ? body.name : "";
      }
      if (body.code !== undefined) {
        input.code = typeof body.code === "string" ? body.code : "";
      }
      if (body.unit !== undefined) {
        input.unit = typeof body.unit === "string" ? body.unit : "";
      }
      if (body.quantity !== undefined) {
        input.quantity =
          typeof body.quantity === "number"
            ? body.quantity
            : Number(body.quantity);
      }
    } else {
      res.status(400).json({ error: "invalid" });
      return;
    }

    // v5: партия чужого участка — 404 (не раскрываем существование).
    const targetLot = lots.getById(id);
    if (targetLot && !permissions.canAccessSite(req.user!, targetLot.siteId)) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const result = corrections.correctReceipt(id, input, req.user!.id);
    if (result.ok) {
      res.status(201).json({ id: result.id });
      return;
    }

    switch (result.error) {
      case "not_found":
        res.status(404).json({ error: "not_found" });
        return;
      case "transfer_locked":
        res.status(409).json({ error: "transfer_locked" });
        return;
      case "already_voided":
        res.status(409).json({ error: "already_voided" });
        return;
      case "has_writeoffs":
        res.status(409).json({ error: "has_writeoffs" });
        return;
      case "exceeds":
        res.status(409).json({ error: "exceeds", balance: result.balance });
        return;
      case "invalid":
        res.status(400).json({ error: "invalid" });
        return;
    }
  },
);

// GET /api/gsm/lots/:id/history — auth.
// worker: только партия его участка (иначе 404); manager: любая.
gsmRouter.get(
  "/api/gsm/lots/:id/history",
  requireAuth,
  (req: Request, res: Response): void => {
    const user = req.user!;
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const result = lots.history(id);
    if (!result) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    // Чужой участок маскируем под 404: воркеру — не его site_id, менеджеру —
    // участок вне выданной ему области видимости (v5).
    if (!permissions.canAccessSite(user, result.lot.siteId)) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.status(200).json({ lot: result.lot, events: result.events });
  },
);

// GET /api/gsm/employees — manager. Все воркеры (активные + архивные).
// active:false — архивные, фронт показывает их замьюченными с кнопкой «Восстановить».
gsmRouter.get(
  "/api/gsm/employees",
  requireAuth,
  requirePermission("users.manage"),
  (req: Request, res: Response): void => {
    // v5: менеджер видит только механиков своих участков; супер-админ — всех.
    const allowed = permissions.allowedSiteIds(req.user!);
    const workers = users
      .listWorkers()
      .filter(
        (w) =>
          allowed === null || (w.siteId != null && allowed.includes(w.siteId)),
      );
    const employees = workers.map((w) => ({
      id: w.id,
      username: w.username,
      displayName: w.displayName,
      siteId: w.siteId,
      siteName: w.siteName,
      active: w.active,
    }));
    res.status(200).json({ employees });
  },
);

// POST /api/gsm/employees — manager. Роль форсится 'worker' (любой role из тела игнорируем).
// Тело: {username,password,displayName,siteId}. siteId — активный участок; пароль≥6.
gsmRouter.post(
  "/api/gsm/employees",
  requireAuth,
  requirePermission("users.manage"),
  async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      username?: unknown;
      password?: unknown;
      displayName?: unknown;
      siteId?: unknown;
    };

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const siteId =
      typeof body.siteId === "number" ? body.siteId : Number(body.siteId);
    const displayNameRaw =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    const displayName = displayNameRaw ? displayNameRaw : null;

    if (!username) {
      res.status(400).json({ error: "invalid_username" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "weak_password" });
      return;
    }
    if (!Number.isInteger(siteId) || siteId <= 0 || !sites.isActive(siteId)) {
      res.status(400).json({ error: "invalid_site" });
      return;
    }
    // Привязать механика можно только к участку из своей области видимости (v5).
    if (!assertSiteAllowed(req, res, siteId)) return;

    const result = await users.createOrReactivateWorker({
      username,
      password,
      displayName,
      siteId,
      createdBy: req.user!.id,
    });

    if ("conflict" in result) {
      res.status(409).json({ error: "username_taken" });
      return;
    }

    res.status(201).json({ id: result.id });
  },
);

// DELETE /api/gsm/employees/:id — manager. Мягкое удаление (is_active=0), только worker.
gsmRouter.delete(
  "/api/gsm/employees/:id",
  requireAuth,
  requirePermission("users.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canManageUser(req, res, id)) return;

    const ok = users.softDeleteWorker(id);
    if (!ok) {
      // Не воркер / не найден / уже удалён → 404.
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.status(204).end();
  },
);

// POST /api/gsm/employees/:id/restore — manager. Восстановление из архива (is_active=1), только worker.
gsmRouter.post(
  "/api/gsm/employees/:id/restore",
  requireAuth,
  requirePermission("users.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canManageUser(req, res, id)) return;

    const ok = users.restoreWorker(id);
    if (!ok) {
      // Не воркер / не найден → 404.
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.status(204).end();
  },
);

// --- RBAC v5: администрирование пользователей, прав и доступов ---------------

// GET /api/gsm/users — право users.manage. Все сотрудники в области видимости
// (менеджеры + механики, активные сверху). Супер-админы видны только супер-админу.
gsmRouter.get(
  "/api/gsm/users",
  requireAuth,
  requirePermission("users.manage"),
  (req: Request, res: Response): void => {
    const scope = permissions.allowedSiteIds(req.user!);
    res.status(200).json({ users: users.listUsers(scope) });
  },
);

// POST /api/gsm/managers — право users.manage. Создание/реактивация менеджера.
// Тело: {username,password,displayName?,siteIds?}. Участок в users.site_id не пишем —
// область менеджера задаётся user_sites. Пароль ≥ 6.
gsmRouter.post(
  "/api/gsm/managers",
  requireAuth,
  requirePermission("users.manage"),
  async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      username?: unknown;
      password?: unknown;
      displayName?: unknown;
      siteIds?: unknown;
    };

    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const displayNameRaw =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    const displayName = displayNameRaw ? displayNameRaw : null;

    if (!username) {
      res.status(400).json({ error: "invalid_username" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "weak_password" });
      return;
    }

    // Выдать можно только те участки, что доступны самому создающему (v5).
    const requested = Array.isArray(body.siteIds)
      ? (body.siteIds as unknown[])
          .map((v) => (typeof v === "number" ? v : Number(v)))
          .filter((v) => Number.isInteger(v) && v > 0)
      : [];
    for (const siteId of requested) {
      if (!assertSiteAllowed(req, res, siteId)) return;
    }

    const result = await users.createOrReactivateManager({
      username,
      password,
      displayName,
      createdBy: req.user!.id,
    });
    if ("conflict" in result) {
      res.status(409).json({ error: "username_taken" });
      return;
    }

    permissions.setSiteIds(result.id, requested, req.user!.id);
    res.status(201).json({ id: result.id });
  },
);

// PATCH /api/gsm/users/:id — право users.manage. Правка сотрудника:
// {displayName?, siteId?, password?}. siteId допустим только для механика.
// Смена пароля — установка нового (текущий не спрашиваем: это админ-операция).
gsmRouter.patch(
  "/api/gsm/users/:id",
  requireAuth,
  requirePermission("users.manage"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canManageUser(req, res, id)) return;

    const body = (req.body ?? {}) as {
      displayName?: unknown;
      siteId?: unknown;
      password?: unknown;
    };

    const patch: {
      displayName?: string | null;
      siteId?: number;
      password?: string;
    } = {};

    if (body.displayName !== undefined) {
      const v = typeof body.displayName === "string" ? body.displayName.trim() : "";
      patch.displayName = v ? v : null;
    }
    if (body.siteId !== undefined) {
      // Перепривязка к участку — это уже access.manage, а не просто users.manage.
      if (!permissions.hasPermission(req.user!, "access.manage")) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const siteId =
        typeof body.siteId === "number" ? body.siteId : Number(body.siteId);
      if (!Number.isInteger(siteId) || siteId <= 0 || !sites.isActive(siteId)) {
        res.status(400).json({ error: "invalid_site" });
        return;
      }
      if (!assertSiteAllowed(req, res, siteId)) return;
      patch.siteId = siteId;
    }
    if (body.password !== undefined) {
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 6) {
        res.status(400).json({ error: "weak_password" });
        return;
      }
      patch.password = password;
    }

    const result = await users.updateUser(id, patch);
    if (result.ok) {
      res.status(204).end();
      return;
    }
    res
      .status(result.reason === "site_not_allowed_for_role" ? 400 : 404)
      .json({ error: result.reason });
  },
);

// DELETE /api/gsm/users/:id — право users.manage. Архивирование сотрудника
// (менеджера или механика). Супер-админ и сам себя — недоступны (404).
gsmRouter.delete(
  "/api/gsm/users/:id",
  requireAuth,
  requirePermission("users.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canManageUser(req, res, id)) return;

    if (!users.softDeleteUser(id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  },
);

// POST /api/gsm/users/:id/restore — право users.manage. Восстановление из архива.
gsmRouter.post(
  "/api/gsm/users/:id/restore",
  requireAuth,
  requirePermission("users.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canManageUser(req, res, id)) return;

    if (!users.restoreUser(id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  },
);

// PUT /api/gsm/users/:id/sites — право access.manage. Полная замена набора участков.
// Тело: {siteIds:number[]}. Только для менеджера: у механика участок один и меняется
// через PATCH /users/:id. Выдать можно только участки из своей области видимости.
gsmRouter.put(
  "/api/gsm/users/:id/sites",
  requireAuth,
  requirePermission("access.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canManageUser(req, res, id)) return;

    const target = users.getById(id)!;
    if (target.role !== "manager") {
      res.status(400).json({ error: "role_not_manager" });
      return;
    }

    const body = (req.body ?? {}) as { siteIds?: unknown };
    if (!Array.isArray(body.siteIds)) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    const siteIds = (body.siteIds as unknown[])
      .map((v) => (typeof v === "number" ? v : Number(v)))
      .filter((v) => Number.isInteger(v) && v > 0);
    for (const siteId of siteIds) {
      if (!assertSiteAllowed(req, res, siteId)) return;
    }

    // Менеджер с ограниченной областью не должен стирать чужие участки цели:
    // сохраняем те, что вне его области видимости.
    const actorScope = permissions.allowedSiteIds(req.user!);
    const preserved =
      actorScope === null
        ? []
        : permissions.listSiteIds(id).filter((s) => !actorScope.includes(s));

    permissions.setSiteIds(id, [...preserved, ...siteIds], req.user!.id);
    res.status(204).end();
  },
);

// PUT /api/gsm/users/:id/permissions — ТОЛЬКО супер-админ. Матрица прав.
// Тело: {permissions:string[]}. Права выдаются только менеджерам.
gsmRouter.put(
  "/api/gsm/users/:id/permissions",
  requireAuth,
  requireSuperadmin,
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const target = users.getById(id);
    if (!target || target.role === "superadmin") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (target.role !== "manager") {
      res.status(400).json({ error: "role_not_manager" });
      return;
    }

    const body = (req.body ?? {}) as { permissions?: unknown };
    if (!Array.isArray(body.permissions)) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    const requested = (body.permissions as unknown[]).filter(
      (p): p is Permission =>
        typeof p === "string" && (ALL_PERMISSIONS as readonly string[]).includes(p),
    );

    permissions.setPermissions(id, requested, req.user!.id);
    res.status(204).end();
  },
);

// --- Справочник инициаторов заявки -----------------------------------------

// GET /api/gsm/initiators — право initiators.manage. Все записи, включая архивные.
gsmRouter.get(
  "/api/gsm/initiators",
  requireAuth,
  requirePermission("initiators.manage"),
  (_req: Request, res: Response): void => {
    res.status(200).json({ initiators: initiators.list({ includeArchived: true }) });
  },
);

// POST /api/gsm/initiators — право initiators.manage. {name,position} → 201 {id}.
gsmRouter.post(
  "/api/gsm/initiators",
  requireAuth,
  requirePermission("initiators.manage"),
  (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as { name?: unknown; position?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const position = typeof body.position === "string" ? body.position.trim() : "";
    if (!name || !position) {
      res.status(400).json({ error: "invalid" });
      return;
    }

    const result = initiators.create({ name, position }, req.user!.id);
    if ("conflict" in result) {
      res.status(409).json({ error: "exists" });
      return;
    }
    res.status(201).json({ id: result.id });
  },
);

// PATCH /api/gsm/initiators/:id — право initiators.manage. {name?,position?} → 204.
gsmRouter.patch(
  "/api/gsm/initiators/:id",
  requireAuth,
  requirePermission("initiators.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const body = (req.body ?? {}) as { name?: unknown; position?: unknown };
    const patch: { name?: string; position?: string } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        res.status(400).json({ error: "invalid" });
        return;
      }
      patch.name = name;
    }
    if (body.position !== undefined) {
      const position =
        typeof body.position === "string" ? body.position.trim() : "";
      if (!position) {
        res.status(400).json({ error: "invalid" });
        return;
      }
      patch.position = position;
    }

    const result = initiators.update(id, patch);
    if (result.ok) {
      res.status(204).end();
      return;
    }
    res.status(result.reason === "exists" ? 409 : 404).json({ error: result.reason });
  },
);

// DELETE /api/gsm/initiators/:id — право initiators.manage. Архивирование (обратимо).
gsmRouter.delete(
  "/api/gsm/initiators/:id",
  requireAuth,
  requirePermission("initiators.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null || !initiators.archive(id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  },
);

// POST /api/gsm/initiators/:id/restore — право initiators.manage. Восстановление.
gsmRouter.post(
  "/api/gsm/initiators/:id/restore",
  requireAuth,
  requirePermission("initiators.manage"),
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null || !initiators.restore(id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  },
);

// --- Расход штучных материалов (v6) -----------------------------------------
// Независимый журнал: без прихода, партий и остатков. Вносит ТОЛЬКО механик,
// участок берётся из его сессии, дата — серверная (сегодня по МСК): из тела
// запроса ни то, ни другое не принимается, поэтому задним числом не внести.

// Разбор фильтров списка. siteIds — область видимости пользователя.
function parsePartIssueFilter(req: Request): partIssues.ListFilter {
  const user = req.user!;
  const q = req.query as Record<string, string | undefined>;

  // Воркер видит только свой участок, менеджер — выданные ему (v5).
  const siteIds =
    user.role === "worker"
      ? user.siteId != null
        ? [user.siteId]
        : []
      : permissions.allowedSiteIds(user);

  const filter: partIssues.ListFilter = { siteIds };

  const siteId = Number(q.siteId);
  if (Number.isInteger(siteId) && siteId > 0) filter.siteId = siteId;
  if (q.dateFrom && isValidDate(q.dateFrom)) filter.dateFrom = q.dateFrom;
  if (q.dateTo && isValidDate(q.dateTo)) filter.dateTo = q.dateTo;
  if (q.search && q.search.trim()) filter.search = q.search.trim();
  if (q.licensePlate && q.licensePlate.trim()) {
    filter.licensePlate = q.licensePlate.trim();
  }
  const authorId = Number(q.authorId);
  if (Number.isInteger(authorId) && authorId > 0) filter.authorId = authorId;

  return filter;
}

// POST /api/gsm/part-issues — worker-only. Тело: {rows:[{partNumber,name,qty,licensePlate,recipient}]}.
// Серия пишется одной транзакцией. Дата — todayMsk(), участок — из сессии.
gsmRouter.post(
  "/api/gsm/part-issues",
  requireAuth,
  (req: Request, res: Response): void => {
    const user = req.user!;
    // Вносит только механик своего участка (канон: менеджер здесь только читает).
    if (user.role !== "worker" || user.siteId == null) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const body = (req.body ?? {}) as { rows?: unknown };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      res.status(400).json({ error: "empty_rows" });
      return;
    }

    const rows: partIssues.PartIssueInput[] = [];
    for (const raw of body.rows as unknown[]) {
      if (!raw || typeof raw !== "object") {
        res.status(400).json({ error: "invalid_row" });
        return;
      }
      const r = raw as {
        partNumber?: unknown;
        name?: unknown;
        qty?: unknown;
        licensePlate?: unknown;
        recipient?: unknown;
        comment?: unknown;
      };
      rows.push({
        partNumber: typeof r.partNumber === "string" ? r.partNumber : "",
        name: typeof r.name === "string" ? r.name : "",
        qty: typeof r.qty === "number" ? r.qty : Number(r.qty),
        licensePlate: typeof r.licensePlate === "string" ? r.licensePlate : "",
        recipient: typeof r.recipient === "string" ? r.recipient : "",
        // Комментарий необязателен: пустая строка эквивалентна его отсутствию.
        comment: typeof r.comment === "string" ? r.comment : null,
      });
    }

    const result = partIssues.createMany(rows, {
      siteId: user.siteId,
      issueDate: todayMsk(),
      createdBy: user.id,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ created: result.created });
  },
);

// GET /api/gsm/part-issues — auth. Журнал в области видимости пользователя.
// Фильтры (query): siteId, dateFrom, dateTo, search, licensePlate, authorId.
gsmRouter.get(
  "/api/gsm/part-issues",
  requireAuth,
  (req: Request, res: Response): void => {
    res
      .status(200)
      .json({ issues: partIssues.list(parsePartIssueFilter(req)) });
  },
);

// GET /api/gsm/part-issues/export — manager. Тот же фильтр, но xlsx-файлом.
gsmRouter.get(
  "/api/gsm/part-issues/export",
  requireAuth,
  requireManager,
  async (req: Request, res: Response): Promise<void> => {
    const rows = partIssues.list(parsePartIssueFilter(req));
    const buf = await createPartIssuesXlsx(rows);
    const filename = `rashod-materialov-${todayMsk()}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(buf);
  },
);

// POST /api/gsm/part-issues/:id/correct — manager. Отмена/правка записи.
// Тело: {action:'void'} | {action:'edit', issueDate?, partNumber?, name?, qty?,
// licensePlate?, recipient?}. Механику недоступно: он только вносит.
gsmRouter.post(
  "/api/gsm/part-issues/:id/correct",
  requireAuth,
  requireManager,
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    // Запись чужого участка маскируем под 404 (единая конвенция роутов).
    const existing = partIssues.getById(id);
    if (!existing || !permissions.canAccessSite(req.user!, existing.siteId)) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const body = (req.body ?? {}) as {
      action?: unknown;
      issueDate?: unknown;
      partNumber?: unknown;
      name?: unknown;
      qty?: unknown;
      licensePlate?: unknown;
      recipient?: unknown;
      comment?: unknown;
    };

    let input: partIssues.CorrectionInput;
    if (body.action === "void") {
      input = { action: "void" };
    } else if (body.action === "edit") {
      input = { action: "edit" };
      if (body.issueDate !== undefined) {
        input.issueDate = typeof body.issueDate === "string" ? body.issueDate : "";
      }
      if (body.partNumber !== undefined) {
        input.partNumber = typeof body.partNumber === "string" ? body.partNumber : "";
      }
      if (body.name !== undefined) {
        input.name = typeof body.name === "string" ? body.name : "";
      }
      if (body.qty !== undefined) {
        input.qty = typeof body.qty === "number" ? body.qty : Number(body.qty);
      }
      if (body.licensePlate !== undefined) {
        input.licensePlate =
          typeof body.licensePlate === "string" ? body.licensePlate : "";
      }
      if (body.recipient !== undefined) {
        input.recipient = typeof body.recipient === "string" ? body.recipient : "";
      }
      if (body.comment !== undefined) {
        input.comment = typeof body.comment === "string" ? body.comment : null;
      }
    } else {
      res.status(400).json({ error: "invalid" });
      return;
    }

    const result = partIssues.correct(id, input, req.user!.id);
    if (result.ok) {
      res.status(201).json({ id: result.id });
      return;
    }
    switch (result.error) {
      case "not_found":
        res.status(404).json({ error: "not_found" });
        return;
      case "already_voided":
        res.status(409).json({ error: "already_voided" });
        return;
      case "invalid":
        res.status(400).json({ error: "invalid" });
        return;
    }
  },
);
