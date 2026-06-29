// Компактный единый хедер ГСМ в одну строку (дизайн-правки этого раунда).
// Слева — лого (ссылка на '/'), справа — имя пользователя, приглушённый сабтайтл
// (manager → «Менеджер»; worker → участок) и кнопка «Выйти». Без заголовка «УЧЁТ ГСМ»
// и без даты. Высота минимальная, всё выровнено по вертикали (banner-стиль: border-b).
// Главную (AppHeader) не трогаем — это отдельный хедер только для страниц ГСМ.

import React from 'react';
import { LogOut } from 'lucide-react';
import type { User } from '../../lib/gsmTypes';

export interface GsmHeaderProps {
  user: User;
  onLogout: () => void;
}

const GsmHeader: React.FC<GsmHeaderProps> = ({ user, onLogout }) => {
  const name = user.displayName || user.username;
  const subtitle =
    user.role === 'manager' ? 'Менеджер' : user.siteName ?? 'участок';

  return (
    <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
      <a href="/" className="flex items-center shrink-0">
        <img src="/logo.svg" alt="logo" className="h-7" />
      </a>

      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0 text-right leading-tight">
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
