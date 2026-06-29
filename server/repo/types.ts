// Канон-типы (§4 ТЗ). Общие для repo-слоя и будущего API-слоя.

export type Role = "manager" | "worker";

// Управляемый участок (таблица sites). active = is_active=1.
export type Site = {
  id: number;
  name: string;
  active: boolean;
};

// Публичный тип пользователя (то, что отдаём наружу/кладём в сессию).
// site заменён на siteId+siteName: NULL у менеджера, NOT NULL у воркера.
export type User = {
  id: number;
  username: string;
  displayName: string | null;
  role: Role;
  siteId: number | null;
  siteName: string | null;
};

// Элемент списка воркеров для админки менеджера (GET /api/gsm/employees).
// Включает active:boolean — архивные (is_active=0) показываются замьюченными.
export type WorkerListItem = {
  id: number;
  username: string;
  displayName: string | null;
  siteId: number | null;
  siteName: string | null;
  active: boolean;
};

// Сырая строка таблицы users (snake_case как в SQLite).
export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  site_id: number | null;
  display_name: string | null;
  is_active: number;
  created_at: string;
  created_by: number | null;
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
  kind: "receipt" | "writeoff" | "transfer_out" | "transfer_in";
  date: string;
  qty: number;
  balanceAfter: number;
  licensePlate?: string;
  reason?: string;
  // Для transfer_out — целевой участок; для transfer_in — исходный участок.
  counterSiteName?: string;
  author: { username: string; displayName: string | null };
};

// Маппинг сырой строки users → публичный User.
// siteName приходит аргументом (JOIN на sites делает вызывающий слой):
// null у менеджера (site_id IS NULL), имя участка у воркера.
export function toUser(row: UserRow, siteName: string | null): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    siteId: row.site_id,
    siteName,
  };
}
