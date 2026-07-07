// API товароучёта ГСМ (Этап 3). Префикс /api/gsm, JSON, фронт credentials:'include'.
// attachUser смонтирован выше по цепочке (index.ts на /api/gsm), req.user — из сессии.
// login/logout/me живут в server/auth/routes.ts (Этап 2) — здесь не дублируем.
// Доверяем ТОЛЬКО серверу: role/site/автор берём из req.user, не из тела (канон §3.4).
// Чужой :id (партия другого участка) → 404, не 403 (не раскрываем существование).

import { Router, type Request, type Response } from "express";
import { requireAuth, requireManager } from "../auth/middleware";
import * as lots from "../repo/lots";
import * as receipts from "../repo/receipts";
import * as writeoffs from "../repo/writeoffs";
import * as users from "../repo/users";
import * as sites from "../repo/sites";
import * as transfers from "../repo/transfers";
import * as corrections from "../repo/corrections";
import { isValidDate } from "../lib/dates";

export const gsmRouter = Router();

// Парсинг :id в положительное целое. NaN/<=0 → null (трактуем как not_found).
function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

// GET /api/gsm/sites — manager. Все участки (активные сверху + архивные).
gsmRouter.get(
  "/api/gsm/sites",
  requireAuth,
  requireManager,
  (_req: Request, res: Response): void => {
    res.status(200).json({ sites: sites.list({ includeArchived: true }) });
  },
);

// GET /api/gsm/sites/active — auth (worker + manager). Только активные участки.
// Нужен для выпадашки целевого участка перемещения у ОБЕИХ ролей
// (воркеру /api/gsm/sites под requireManager недоступен).
gsmRouter.get(
  "/api/gsm/sites/active",
  requireAuth,
  (_req: Request, res: Response): void => {
    res.status(200).json({ sites: sites.list({ includeArchived: false }) });
  },
);

// POST /api/gsm/sites — manager. Создание участка. {name} → 201 {id}.
// Пустое/непстрока → 400 invalid; дубликат NOCASE → 409 exists.
gsmRouter.post(
  "/api/gsm/sites",
  requireAuth,
  requireManager,
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
    res.status(201).json({ id: result.id });
  },
);

// POST /api/gsm/sites/:id/archive — manager. Архивирование (is_active=0).
// not_found → 404; активный воркер → 409 has_workers; остаток>EPS → 409 has_stock.
gsmRouter.post(
  "/api/gsm/sites/:id/archive",
  requireAuth,
  requireManager,
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

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
  requireManager,
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const ok = sites.restore(id);
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  },
);

// GET /api/gsm/lots — auth.
// manager: все партии; worker: сервер фильтрует по session.siteId (query игнорируем).
gsmRouter.get(
  "/api/gsm/lots",
  requireAuth,
  (req: Request, res: Response): void => {
    const user = req.user!;
    const list =
      user.role === "manager"
        ? lots.list({})
        : lots.list({ siteId: user.siteId ?? 0 });
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

// POST /api/gsm/writeoffs/:id/correct — manager. Сторно/правка списания (v4).
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

// POST /api/gsm/receipts/:id/correct — manager. Сторно/правка прихода (партии) (v4).
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

    // Воркер видит только свою партию — чужой участок маскируем под 404.
    if (user.role === "worker" && result.lot.siteId !== user.siteId) {
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
  requireManager,
  (_req: Request, res: Response): void => {
    const workers = users.listWorkers();
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
  requireManager,
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
  requireManager,
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

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
  requireManager,
  (req: Request, res: Response): void => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const ok = users.restoreWorker(id);
    if (!ok) {
      // Не воркер / не найден → 404.
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.status(204).end();
  },
);
