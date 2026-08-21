// Типизированные фетчеры /api/gsm/* (канон §4). Все запросы — credentials:'include',
// JSON. Сессия живёт в httpOnly cookie gsm_sid, в JS её не видно.
// На !ok бросаем ApiError с .status и распарсенным телом (.body).

import type {
  User,
  Lot,
  HistoryEvent,
  Employee,
  Site,
  AdminUser,
  Initiator,
  Permission,
  PartIssue,
  PartIssueFilter,
} from './gsmTypes';

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

// GET /sites/active → Site[] активных. requireAuth: доступно ОБЕИМ ролям
// (воркеру /sites недоступен) — для выпадашки целевого участка перемещения.
export async function getActiveSites(): Promise<Site[]> {
  const { data } = await request<{ sites: Site[] }>('/sites/active');
  return data.sites.map((s) => ({
    id: s.id,
    name: s.name,
    active: Boolean(s.active),
  }));
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

// POST /lots/:id/transfer {toSiteId,qty,date} → {toReceiptId}. requireAuth.
// Атомарно: списание с исходной партии + новая партия на целевом участке.
// Ошибки пробрасываются как ApiError (.status / .body):
//   400 {error:'date'|'same_site'|'inactive_site'|'invalid'}
//   404 {error:'not_found'} (нет партии / воркер чужого участка)
//   409 {error:'exceeds', balance} — превышение остатка исходной партии.
export async function transferLot(
  lotId: number,
  body: { toSiteId: number; qty: number; date: string }
): Promise<{ toReceiptId: number }> {
  const { data } = await request<{ toReceiptId: number }>(
    `/lots/${lotId}/transfer`,
    { method: 'POST', body }
  );
  return data;
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

// --- Корректировки (manager-only) ---

// Тело POST /writeoffs/:id/correct: отмена записи (void) или правка полей списания (edit).
export type WriteoffCorrectPayload =
  | { action: 'void' }
  | {
      action: 'edit';
      date?: string;
      amount?: number;
      licensePlate?: string;
      reason?: string;
    };

// POST /writeoffs/:id/correct → 201 {id}. Ошибки пробрасываем как ApiError:
//   400 {error:'invalid'}; 404;
//   409 {error:'transfer_locked'|'already_voided'} | {error:'exceeds', balance}.
// UI читает код ошибки из .message (это поле error) и balance из .body.
export async function correctWriteoff(
  id: number,
  body: WriteoffCorrectPayload
): Promise<{ id: number }> {
  const { data } = await request<{ id: number }>(`/writeoffs/${id}/correct`, {
    method: 'POST',
    body,
  });
  return data;
}

// Тело POST /receipts/:id/correct (id прихода = id партии lot.id).
// Участок через edit не меняется — для этого «Переместить».
export type ReceiptCorrectPayload =
  | { action: 'void' }
  | {
      action: 'edit';
      receivedDate?: string;
      name?: string;
      code?: string;
      unit?: string;
      quantity?: number;
    };

// POST /receipts/:id/correct → 201 {id}. Ошибки — как у correctWriteoff,
// плюс 409 {error:'has_writeoffs'} (отмена прихода, по которому есть списания).
export async function correctReceipt(
  id: number,
  body: ReceiptCorrectPayload
): Promise<{ id: number }> {
  const { data } = await request<{ id: number }>(`/receipts/${id}/correct`, {
    method: 'POST',
    body,
  });
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

// --- RBAC v5: пользователи, права, доступы ---

// PATCH /sites/:id {name} → 204. 400 invalid / 409 exists / 404 → ApiError.
export async function renameSite(id: number, name: string): Promise<void> {
  await request<void>(`/sites/${id}`, { method: 'PATCH', body: { name } });
}

// GET /users → AdminUser[]. Все сотрудники в области видимости (менеджеры + механики).
export async function getUsers(): Promise<AdminUser[]> {
  const { data } = await request<{ users: AdminUser[] }>('/users');
  return data.users;
}

// POST /managers {username,password,displayName?,siteIds?} → {id}.
// 400 invalid_username|weak_password / 409 username_taken → ApiError.
export async function createManager(input: {
  username: string;
  password: string;
  displayName: string;
  siteIds: number[];
}): Promise<{ id: number }> {
  const { data } = await request<{ id: number }>('/managers', {
    method: 'POST',
    body: input,
  });
  return data;
}

// PATCH /users/:id {displayName?,siteId?,password?} → 204.
// siteId требует права access.manage (иначе 403).
export async function updateUser(
  id: number,
  patch: { displayName?: string; siteId?: number; password?: string },
): Promise<void> {
  await request<void>(`/users/${id}`, { method: 'PATCH', body: patch });
}

// DELETE /users/:id → 204. Архивирование сотрудника (менеджера или механика).
export async function archiveUser(id: number): Promise<void> {
  await request<void>(`/users/${id}`, { method: 'DELETE' });
}

// POST /users/:id/restore → 204.
export async function restoreUser(id: number): Promise<void> {
  await request<void>(`/users/${id}/restore`, { method: 'POST' });
}

// PUT /users/:id/sites {siteIds} → 204. Полная замена доступов менеджера (access.manage).
export async function setUserSites(id: number, siteIds: number[]): Promise<void> {
  await request<void>(`/users/${id}/sites`, { method: 'PUT', body: { siteIds } });
}

// PUT /users/:id/permissions {permissions} → 204. Только супер-админ, только менеджерам.
export async function setUserPermissions(
  id: number,
  permissions: Permission[],
): Promise<void> {
  await request<void>(`/users/${id}/permissions`, {
    method: 'PUT',
    body: { permissions },
  });
}

// --- Справочник инициаторов ---

// GET /initiators → Initiator[] (включая архивные). Требует права initiators.manage.
export async function getInitiators(): Promise<Initiator[]> {
  const { data } = await request<{ initiators: Initiator[] }>('/initiators');
  return data.initiators;
}

// GET /api/initiators — ПУБЛИЧНЫЙ (форма заявки без авторизации), только активные.
// Мимо BASE=/api/gsm, поэтому обычный fetch.
export async function getPublicInitiators(): Promise<Initiator[]> {
  const res = await fetch('/api/initiators');
  if (!res.ok) throw new ApiError(res.status, null);
  const data = (await res.json()) as { initiators: Initiator[] };
  return data.initiators;
}

// POST /initiators {name,position} → {id}. 400 invalid / 409 exists → ApiError.
export async function createInitiator(input: {
  name: string;
  position: string;
}): Promise<{ id: number }> {
  const { data } = await request<{ id: number }>('/initiators', {
    method: 'POST',
    body: input,
  });
  return data;
}

// PATCH /initiators/:id {name?,position?} → 204.
export async function updateInitiator(
  id: number,
  patch: { name?: string; position?: string },
): Promise<void> {
  await request<void>(`/initiators/${id}`, { method: 'PATCH', body: patch });
}

// DELETE /initiators/:id → 204. Архивирование (обратимо через restoreInitiator).
export async function archiveInitiator(id: number): Promise<void> {
  await request<void>(`/initiators/${id}`, { method: 'DELETE' });
}

// POST /initiators/:id/restore → 204.
export async function restoreInitiator(id: number): Promise<void> {
  await request<void>(`/initiators/${id}/restore`, { method: 'POST' });
}

// --- Расход штучных материалов (v6) ---

// Сборка query-строки фильтра: пустые значения не отправляем.
function partIssueQuery(filter: PartIssueFilter): string {
  const q = new URLSearchParams();
  if (filter.siteId) q.set('siteId', String(filter.siteId));
  if (filter.dateFrom) q.set('dateFrom', filter.dateFrom);
  if (filter.dateTo) q.set('dateTo', filter.dateTo);
  if (filter.search?.trim()) q.set('search', filter.search.trim());
  if (filter.licensePlate?.trim()) q.set('licensePlate', filter.licensePlate.trim());
  if (filter.authorId) q.set('authorId', String(filter.authorId));
  const s = q.toString();
  return s ? `?${s}` : '';
}

// GET /part-issues → PartIssue[]. Сервер сам режет по участкам роли.
export async function getPartIssues(
  filter: PartIssueFilter = {},
): Promise<PartIssue[]> {
  const { data } = await request<{ issues: PartIssue[] }>(
    `/part-issues${partIssueQuery(filter)}`,
  );
  return data.issues;
}

// POST /part-issues — worker-only. Дату и участок ставит сервер, отправлять их не нужно.
// 400 empty_rows | invalid_row, 403 forbidden → ApiError.
export async function createPartIssues(
  rows: Array<{
    partNumber: string;
    name: string;
    qty: number;
    licensePlate: string;
    recipient: string;
  }>,
): Promise<{ created: number }> {
  const { data } = await request<{ created: number }>('/part-issues', {
    method: 'POST',
    body: { rows },
  });
  return data;
}

// POST /part-issues/:id/correct — manager. Отмена записи или правка.
// 404 not_found, 409 already_voided, 400 invalid → ApiError.
export async function correctPartIssue(
  id: number,
  input:
    | { action: 'void' }
    | {
        action: 'edit';
        issueDate?: string;
        partNumber?: string;
        name?: string;
        qty?: number;
        licensePlate?: string;
        recipient?: string;
      },
): Promise<{ id: number }> {
  const { data } = await request<{ id: number }>(`/part-issues/${id}/correct`, {
    method: 'POST',
    body: input,
  });
  return data;
}

// Ссылка на выгрузку xlsx по текущему фильтру. Скачивание идёт обычным переходом
// браузера (cookie-сессия отправится сама), поэтому тут только URL.
export function partIssuesExportUrl(filter: PartIssueFilter = {}): string {
  return `${BASE}/part-issues/export${partIssueQuery(filter)}`;
}
