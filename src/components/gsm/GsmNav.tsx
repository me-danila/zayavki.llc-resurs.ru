// Навигация по разделам ГСМ для менеджера/админа — в строке хедера.
// Состав вкладок — src/lib/gsmNav.ts, фильтр по матрице прав. У механика её нет.
//
// Десктоп: текстовые кнопки-вкладки, без иконок.
// Мобильный: те же разделы одним компактным <select> — пять подписей в строку хедера
// не помещаются, а горизонтальная прокрутка на телефоне почти не обнаруживается.

import React from 'react';
import type { User } from '../../lib/gsmTypes';
import { visibleNavItems } from '../../lib/gsmNav';
import { linkHandler, navigate } from '../../lib/router';

export interface GsmNavProps {
  user: User;
  // Текущий путь (из useRoute) — по нему подсвечиваем активный раздел.
  path: string;
}

const GsmNav: React.FC<GsmNavProps> = ({ user, path }) => {
  const items = visibleNavItems(user);
  if (items.length <= 1) return null;

  return (
    <>
      <nav className="hidden items-center gap-1 sm:flex">
        {items.map((item) => {
          const active = path === item.href;
          return (
            <a
              key={item.href}
              href={item.href}
              onClick={linkHandler(item.href)}
              aria-current={active ? 'page' : undefined}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors ${
                active
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      <select
        aria-label="Раздел"
        value={items.some((i) => i.href === path) ? path : items[0].href}
        onChange={(e) => navigate(e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold uppercase tracking-widest text-gray-900 sm:hidden"
      >
        {items.map((item) => (
          <option key={item.href} value={item.href}>
            {item.label}
          </option>
        ))}
      </select>
    </>
  );
};

export default GsmNav;
