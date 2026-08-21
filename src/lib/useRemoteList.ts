// Загрузка списка с сервера: данные + флаг ошибки + refetch для обновления
// после действий (создание/архив/правка).
//
// Почему не «setState в начале, потом await»: правило react-hooks/set-state-in-effect
// запрещает вызывать из тела эффекта функцию, которая трогает setState. Здесь эффект
// сам вызывает промис и меняет состояние ТОЛЬКО в его колбэке — это и есть
// «подписка на внешний источник» из документации React.
// Бонусом флаг alive: ответ, пришедший после размонтирования, игнорируется.

import React from 'react';

export interface RemoteList<T> {
  // null — данные ещё не загружены ни разу.
  data: T | null;
  error: boolean;
  setError: React.Dispatch<React.SetStateAction<boolean>>;
  refetch: () => Promise<void>;
}

// load обязан быть стабильным (useCallback), иначе эффект будет перезапускаться.
export function useRemoteList<T>(load: () => Promise<T>): RemoteList<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void load().then(
      (result) => {
        if (!alive) return;
        setData(result);
        setError(false);
      },
      () => {
        if (alive) setError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [load]);

  const refetch = React.useCallback(async () => {
    try {
      const result = await load();
      setData(result);
      setError(false);
    } catch {
      setError(true);
    }
  }, [load]);

  return { data, error, setError, refetch };
}
