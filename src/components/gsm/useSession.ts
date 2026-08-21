// Хук сессии ГСМ. На mount тянет getMe(); даёт текущего пользователя и управление им.
// user=null + loading=false → показываем логин. user=null + loading=true → спиннер.

import React from 'react';
import * as api from '../../lib/gsmApi';
import type { User } from '../../lib/gsmTypes';

export interface SessionState {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useSession(): SessionState {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);

  // loading НЕ взводим в начале: стартовое значение уже true, а повторный refetch
  // не должен гасить отрисованный экран спиннером.
  const refetch = React.useCallback(async () => {
    try {
      const me = await api.getMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  // Резолв сессии на монтировании. Состояние меняем в колбэках промиса, а не
  // вызовом refetch: правило react-hooks/set-state-in-effect запрещает вызывать из
  // тела эффекта функцию, которая трогает setState. alive отсекает ответ, пришедший
  // после размонтирования.
  React.useEffect(() => {
    let alive = true;
    void api.getMe().then(
      (me) => {
        if (!alive) return;
        setUser(me);
        setLoading(false);
      },
      () => {
        if (!alive) return;
        setUser(null);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return { user, loading, setUser, refetch, logout };
}
