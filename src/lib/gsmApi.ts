// Типизированные фетчеры /api/gsm/* (канон §4). Все запросы — credentials:'include',
// JSON. Сессия живёт в httpOnly cookie gsm_sid, в JS её не видно.
// На !ok бросаем ApiError с .status и распарсенным телом (.body).

import type { User, Lot, HistoryEvent, Employee, Site } from './gsmTypes';

const BASE = '/api/gsm';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// Общий низкоуровневый запрос. На !ok парсит тело (если есть) и бросает ApiError.
async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<{ status: number; data: T }> {
  const { method = 'GET', body } = options;
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Пытаемся прочитать JSON-тело (204/пустое тело → null).
  let parsed: unknown = null;
  if (res.status !== 204) {
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
  }

  if (!res.ok) {
    const msg =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : undefined;
    throw new ApiError(res.status, parsed, msg);
  }

  return { status: res.status, data: parsed as T };
}

// --- Auth ---

// GET /me → User. 401 (нет/протух сессии) → null (а не throw).
export async function getMe(): Promise<User | null> {
  try {
    const { data } = await request<{ user: User }>('/me');
    return data.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

// POST /login {username,password} → User. 401 → ApiError(status:401).
export async function login(username: string, password: string): Promise<User> {
  const { data } = await request<{ user: User }>('/login', {
    method: 'POST',
    body: { username, password },
  });
  return data.user;
}

// POST /logout → 204.
export async function logout(): Promise<void> {
  await request<void>('/logout', { method: 'POST' });
}

// --- Sites (manager-only) ---

// GET /sites → Site[]. Все участки: активные сверху, архивные ниже.
export async function getSites(): Promise<Site[]> {
  const { data } = await request<{ sites: Site[] }>('/sites');
  return data.sites.map((s) => ({
    id: s.id,
    name: s.name,
    active: Boolean(s.active),
  }));
}

// POST /sites {name} → {id}. 400 {error:'invalid'} / 409 {error:'exists'} → ApiError.
export async function createSite(name: string): Promise<{ id: number }> {
  const { data } = await request<{ id: number }>('/sites', {
    method: 'POST',
    body: { name },
  });
  return data;
}

// POST /sites/:id/archive → 204. 404 / 409 {error:'has_stock'|'has_workers'} → ApiError
// (тело в .body, error в .message — пробрасываем как есть, чтобы UI показал причину).
export async function archiveSite(id: number): Promise<void> {
  await request<void>(`/sites/${id}/archive`, { method: 'POST' });
}

// POST /sites/:id/restore → 204. Возврат архивного участка в активные (is_active=1).
export async function restoreSite(id: number): Promise<void> {
  await request<void>(`/sites/${id}/restore`, { method: 'POST' });
}

// --- Lots / inventory ---

// GET /lots → Lot[]. Сервер сам фильтрует по роли/участку.
export async function getLots(): Promise<Lot[]> {
  const { data } = await request<{ lots: Lot[] }>('/lots');
  return data.lots;
}

// POST /receipts {rows} → {created}. manager-only (форсится сервером).
export type ReceiptRowPayload = {
  receivedDate: string;
  siteId: number;
  name: string;
  code: string;
  unit: string;
  quantity: number;
};
export async function createReceipts(
  rows: ReceiptRowPayload[]
): Promise<{ created: number }> {
  const { data } = await request<{ created: number }>('/receipts', {
    method: 'POST',
    body: { rows },
  });
  return data;
}

// POST /lots/:id/writeoffs {rows} → {created}. worker-only.
// 409 (превышение остатка) пробрасываем как {status:409, balance}.
export type WriteOffRowPayload = {
  date: string;
  licensePlate: string;
  amount: number;
  reason: string;
};
export async function createWriteoffs(
  lotId: number,
  rows: WriteOffRowPayload[]
): Promise<{ created: number }> {
  try {
    const { data } = await request<{ created: number }>(
      `/lots/${lotId}/writeoffs`,
      { method: 'POST', body: { rows } }
    );
    return data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const body = err.body as { balance?: number } | null;
      throw { status: 409, balance: body?.balance } as {
        status: 409;
        balance?: number;
      };
    }
    throw err;
  }
}

// GET /lots/:id/history → {lot, events}.
export async function getHistory(
  lotId: number
): Promise<{ lot: Lot; events: HistoryEvent[] }> {
  const { data } = await request<{ lot: Lot; events: HistoryEvent[] }>(
    `/lots/${lotId}/history`
  );
  return data;
}

// --- Employees (manager-only) ---

// GET /employees → Employee[] (все воркеры: активные сверху, архивные ниже).
// Маппим явно — в т.ч. active (бэк уже отдаёт boolean, нормализуем на всякий).
export async function getEmployees(): Promise<Employee[]> {
  const { data } = await request<{ employees: Employee[] }>('/employees');
  return data.employees.map((e) => ({
    id: e.id,
    username: e.username,
    displayName: e.displayName,
    siteId: e.siteId,
    siteName: e.siteName,
    active: Boolean(e.active),
  }));
}

// POST /employees → {id}. Роль форсится 'worker' сервером.
export async function createEmployee(input: {
  username: string;
  password: string;
  displayName: string;
  siteId: number;
}): Promise<{ id: number }> {
  const { data } = await request<{ id: number }>('/employees', {
    method: 'POST',
    body: input,
  });
  return data;
}

// DELETE /employees/:id → 204. Это АРХИВИРОВАНИЕ (soft-delete is_active=0 на сервере),
// а не физическое удаление: сотрудник остаётся в списке замьюченным.
export async function deleteEmployee(id: number): Promise<void> {
  await request<void>(`/employees/${id}`, { method: 'DELETE' });
}

// POST /employees/:id/restore → 204. Возврат архивного воркера в активные (is_active=1).
export async function restoreEmployee(id: number): Promise<void> {
  await request<void>(`/employees/${id}/restore`, { method: 'POST' });
}
