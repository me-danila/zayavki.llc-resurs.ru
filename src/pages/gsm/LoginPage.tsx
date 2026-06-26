// Экран входа ГСМ. Центрированная карточка в стиле PasswordGate.
// react-hook-form + zod LoginSchema; submit → api.login → onAuthed(user).
// 401 → «Неверный логин или пароль»; прочее → общая ошибка.

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn } from 'lucide-react';
import { LoginSchema } from '../../lib/gsmSchemas';
import type { LoginData } from '../../lib/gsmSchemas';
import * as api from '../../lib/gsmApi';
import { ApiError } from '../../lib/gsmApi';
import type { User } from '../../lib/gsmTypes';

interface LoginPageProps {
  onAuthed: (user: User) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onAuthed }) => {
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<LoginData>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = async (data: LoginData) => {
    setFormError(null);
    try {
      const user = await api.login(data.username, data.password);
      onAuthed(user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setFormError('Неверный логин или пароль');
      } else if (err instanceof ApiError && err.status === 429) {
        setFormError('Слишком много попыток. Попробуйте позже.');
      } else {
        setFormError('Не удалось войти. Попробуйте позже.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center px-4 font-sans">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-sm space-y-4"
      >
        <div className="flex items-center gap-2 text-gray-700">
          <LogIn className="w-5 h-5 text-gray-400" />
          <h1 className="text-sm font-bold uppercase tracking-wide">Вход — учёт ГСМ</h1>
        </div>

        <div>
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
            Логин
          </label>
          <input
            type="text"
            autoFocus
            autoComplete="username"
            {...register('username')}
            className="resource-input text-sm"
            placeholder="Логин"
          />
          {errors.username && (
            <p className="mt-1 text-[10px] text-red-500">{errors.username.message}</p>
          )}
        </div>

        <div>
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
            Пароль
          </label>
          <input
            type="password"
            autoComplete="current-password"
            {...register('password')}
            className="resource-input text-sm"
            placeholder="Пароль"
          />
          {errors.password && (
            <p className="mt-1 text-[10px] text-red-500">{errors.password.message}</p>
          )}
        </div>

        {formError && <p className="text-xs text-red-500">{formError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-gray-900 text-white w-full py-3 rounded-lg font-bold uppercase text-xs tracking-widest hover:bg-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          Войти
          {isSubmitting && (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          )}
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
