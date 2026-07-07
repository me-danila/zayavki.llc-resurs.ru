// Зеркало бэкенд-контракта §4 (docs/gsm-roadmap.md). Источник истины — сервер.
// Эти типы — то, что приходит/уходит по /api/gsm/*.

export type Role = 'manager' | 'worker';

// Управляемый участок (раньше был статичный LOTS). active=false → архивный (is_active=0).
export type Site = {
  id: number;
  name: string;
  active: boolean;
};

export type User = {
  id: number;
  username: string;
  displayName: string | null;
  role: Role;
  siteId: number | null;
  siteName: string | null;
};

export type Lot = {
  id: number;
  name: string;
  code: string;
  siteId: number;
  siteName: string;
  unit: string;
  initialQty: number;
  balance: number;
  receivedDate: string;
  author: { username: string; displayName: string | null };
};

export type HistoryEvent = {
  kind: 'receipt' | 'writeoff' | 'transfer_out' | 'transfer_in';
  date: string;
  qty: number;
  balanceAfter: number;
  licensePlate?: string;
  reason?: string;
  // На чей участок ушло (transfer_out) / с чьего пришло (transfer_in).
  counterSiteName?: string;
  author: { username: string; displayName: string | null };
  // id списания — для кнопок сторно/правки (у прихода есть id партии).
  writeoffId?: number;
  // Действующая корректировка (v4): значения события уже эффективные,
  // original — то, что было ДО корректировки; date — день правки (YYYY-MM-DD).
  correction?: {
    action: 'void' | 'edit';
    author: { username: string; displayName: string | null };
    date: string;
    original: {
      qty: number;
      date: string;
      licensePlate?: string;
      reason?: string;
      name?: string;
      code?: string;
      unit?: string;
    };
  };
};

// Сотрудник (воркер) в списке менеджера — ответ GET /api/gsm/employees.
// active=false → архивный (soft-delete is_active=0): показываем замьюченным
// с кнопкой «Восстановить». Активные приходят с сервера сверху.
export type Employee = {
  id: number;
  username: string;
  displayName: string | null;
  siteId: number | null;
  siteName: string | null;
  active: boolean;
};
