// Компактный единый хедер ГСМ в одну строку.
// Слева — лого (ссылка на '/'), по центру — вкладки разделов (только менеджер/админ),
// справа — имя пользователя, приглушённый сабтайтл (superadmin → «Администратор»,
// manager → «Менеджер», worker → участок) и кнопка «Выйти».
// На узких экранах при наличии навигации имя прячем: иначе выпадашке разделов
// не остаётся ширины. Имя и роль видны на sm+ и всегда на странице механика.
// Высота минимальная, всё выровнено по вертикали (banner-стиль: border-b).
// Главную (AppHeader) не трогаем — это отдельный хедер только для страниц ГСМ.

import React from 'react';
import { LogOut } from 'lucide-react';
import type { User } from '../../lib/gsmTypes';

export interface GsmHeaderProps {
  user: User;
  onLogout: () => void;
  // Навигация по разделам — в той же строке, между лого и блоком пользователя.
  // Если не передана, хедер выглядит как раньше (страница механика).
  nav?: React.ReactNode;
}

const GsmHeader: React.FC<GsmHeaderProps> = ({ user, onLogout, nav }) => {
  const name = user.displayName || user.username;
  const subtitle =
    user.role === 'superadmin'
      ? 'Администратор'
      : user.role === 'manager'
        ? 'Менеджер'
        : user.siteName ?? 'участок';

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
      <a href="/" className="flex items-center shrink-0">
        <img src="/logo.svg" alt="logo" className="h-6 sm:h-7" />
      </a>

      {/* Вкладки забирают свободное место и прокручиваются на узких экранах,
          не выталкивая блок пользователя. */}
      {nav && <div className="min-w-0 flex-1">{nav}</div>}

      <div className={`flex items-center gap-3 min-w-0 ${nav ? '' : 'ml-auto'}`}>
        <div
          className={`min-w-0 text-right leading-tight ${nav ? 'hidden sm:block' : ''}`}
        >
          <div className="truncate text-sm font-bold text-gray-900">{name}</div>
          <div className="truncate text-[11px] uppercase tracking-wide text-gray-400">
            {subtitle}
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900 transition-colors shrink-0"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Выйти</span>
        </button>
      </div>
    </header>
  );
};

export default GsmHeader;
