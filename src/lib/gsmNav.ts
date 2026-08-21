// Состав навигации ГСМ и фильтрация по правам.
// Вынесено из компонента: файл с компонентом должен экспортировать только компонент
// (иначе ломается react-refresh — правило react-refresh/only-export-components).

import type { Permission, User } from './gsmTypes';

export interface NavItem {
  href: string;
  label: string;
  // Требуемое право; undefined — раздел доступен любому менеджеру/админу.
  permission?: Permission;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/gsm', label: 'Приход' },
  { href: '/gsm/parts', label: 'Материалы' },
  { href: '/gsm/stock', label: 'Остатки' },
  { href: '/gsm/sites', label: 'Участки', permission: 'sites.manage' },
  { href: '/gsm/staff', label: 'Сотрудники', permission: 'users.manage' },
  { href: '/gsm/initiators', label: 'Инициаторы', permission: 'initiators.manage' },
];

// Вкладки механика: только ГСМ и расход материалов. Матрица прав к нему
// не применяется — у воркера её нет по определению.
export const WORKER_NAV_ITEMS: NavItem[] = [
  { href: '/gsm', label: 'ГСМ' },
  { href: '/gsm/parts', label: 'Материалы' },
];

// Разделы, доступные пользователю. Раздел без права не показываем вовсе
// (сервер всё равно перепроверяет каждый роут).
export function visibleNavItems(user: User): NavItem[] {
  if (user.role === 'worker') return WORKER_NAV_ITEMS;
  return NAV_ITEMS.filter(
    (item) => !item.permission || user.permissions.includes(item.permission),
  );
}
