// Мини-роутер для /gsm (React 19, без зависимостей — в проекте нет react-router).
// Работает поверх History API: navigate() делает pushState + уведомляет подписчиков,
// useRoute() возвращает текущий pathname и переподписывается на popstate (кнопки
// «назад»/«вперёд»). SPA-fallback на сервере отдаёт index.html на любой GET,
// поэтому прямое открытие /gsm/stock и F5 работают.

import React from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

// Переход по внутренней ссылке. Повторный переход на текущий путь игнорируем,
// чтобы не плодить одинаковые записи в истории.
export function navigate(to: string): void {
  if (to === window.location.pathname) return;
  window.history.pushState(null, '', to);
  window.scrollTo(0, 0);
  notify();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

function getPathname(): string {
  // Хвостовой слэш убираем: /gsm/ и /gsm — один и тот же маршрут.
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

// Текущий путь. useSyncExternalStore — корректная подписка на внешний стор
// (History API) без useEffect-каскадов.
export function useRoute(): string {
  return React.useSyncExternalStore(subscribe, getPathname, getPathname);
}

// Обработчик клика для <a>: перехватываем обычный левый клик, оставляя браузеру
// Ctrl/Cmd/Shift-клик и клик средней кнопкой (открытие в новой вкладке).
export function linkHandler(
  to: string,
): (e: React.MouseEvent<HTMLAnchorElement>) => void {
  return (e) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
}
