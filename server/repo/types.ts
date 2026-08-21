// Канон-типы (§4 ТЗ). Общие для repo-слоя и будущего API-слоя.

export type Role = "superadmin" | "manager" | "worker";

// Права матрицы RBAC (таблица user_permissions). Супер-админ имеет все неявно.
// sites.manage      — создавать/переименовывать/архивировать участки
// users.manage      — создавать/редактировать/архивировать сотрудников (менеджеров и механиков)
// access.manage     — привязывать сотрудников к участкам
// initiators.manage — вести справочник инициаторов заявки
export const ALL_PERMISSIONS = [
  "sites.manage",
  "users.manage",
  "access.manage",
  "initiators.manage",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

// Инициатор заявки (таблица initiators). Бывший хардкод src/data/initiatorData.tsx.
export type Initiator = {
  id: number;
  name: string;
  position: string;
  active: boolean;
};

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

// Строка списка пользователей в админке (GET /api/gsm/users).
// permissions/siteIds заполняются только для менеджеров — у воркера область
// определяется его siteId, у супер-админа права неявные.
export type UserListItem = {
  id: number;
  username: string;
  displayName: string | null;
  role: Role;
  siteId: number | null;
  siteName: string | null;
  active: boolean;
  permissions: Permission[];
  siteIds: number[];
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

// Расход штучных материалов (v6). Значения ЭФФЕКТИВНЫЕ: действует последняя
// корректировка; voided=true — запись отменена (в таблице показываем зачёркнутой).
export type PartIssue = {
  id: number;
  siteId: number;
  siteName: string;
  issueDate: string;
  partNumber: string;
  name: string;
  qty: number;
  licensePlate: string;
  recipient: string;
  voided: boolean;
  author: { username: string; displayName: string | null };
  // Действующая корректировка: original — то, что было ДО правки.
  correction?: {
    action: "void" | "edit";
    date: string;
    author: { username: string; displayName: string | null };
    original: {
      issueDate: string;
      partNumber: string;
      name: string;
      qty: number;
      licensePlate: string;
      recipient: string;
    };
  };
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
  // id списания — для кнопок отмены/правки на фронте (у прихода есть id партии).
  writeoffId?: number;
  // Действующая корректировка (v4): значения события уже эффективные,
  // original — то, что было ДО корректировки; date — день правки (YYYY-MM-DD).
  correction?: {
    action: "void" | "edit";
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
