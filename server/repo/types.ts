// Канон-типы (§4 ТЗ). Общие для repo-слоя и будущего API-слоя.

export type Role = "manager" | "worker";

// Публичный тип пользователя (то, что отдаём наружу/кладём в сессию).
export type User = {
  id: number;
  username: string;
  displayName: string | null;
  role: Role;
  site: string | null;
};

// Элемент списка воркеров для админки менеджера (GET /api/gsm/employees).
// Включает active:boolean — архивные (is_active=0) показываются замьюченными.
export type WorkerListItem = {
  id: number;
  username: string;
  displayName: string | null;
  site: string | null;
  active: boolean;
};

// Сырая строка таблицы users (snake_case как в SQLite).
export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  site: string | null;
  display_name: string | null;
  is_active: number;
  created_at: string;
  created_by: number | null;
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
  kind: "receipt" | "writeoff";
  date: string;
  qty: number;
  balanceAfter: number;
  licensePlate?: string;
  reason?: string;
  author: { username: string; displayName: string | null };
};

// Маппинг сырой строки users → публичный User.
export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    site: row.site,
  };
}
