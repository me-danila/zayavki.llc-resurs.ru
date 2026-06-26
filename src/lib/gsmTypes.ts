// Зеркало бэкенд-контракта §4 (docs/gsm-roadmap.md). Источник истины — сервер.
// Эти типы — то, что приходит/уходит по /api/gsm/*.

export type Role = 'manager' | 'worker';

export type User = {
  id: number;
  username: string;
  displayName: string | null;
  role: Role;
  site: string | null;
};

export type Lot = {
  id: number;
  name: string;
  code: string;
  site: string;
  unit: string;
  initialQty: number;
  balance: number;
  receivedDate: string;
  author: { username: string; displayName: string | null };
};

export type HistoryEvent = {
  kind: 'receipt' | 'writeoff';
  date: string;
  qty: number;
  balanceAfter: number;
  licensePlate?: string;
  reason?: string;
  author: { username: string; displayName: string | null };
};

// Сотрудник (воркер) в списке менеджера — ответ GET /api/gsm/employees.
// active=false → архивный (soft-delete is_active=0): показываем замьюченным
// с кнопкой «Восстановить». Активные приходят с сервера сверху.
export type Employee = {
  id: number;
  username: string;
  displayName: string | null;
  site: string | null;
  active: boolean;
};
