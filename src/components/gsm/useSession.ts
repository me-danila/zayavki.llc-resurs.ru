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

  const refetch = React.useCallback(async () => {
    setLoading(true);
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

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  return { user, loading, setUser, refetch, logout };
}
