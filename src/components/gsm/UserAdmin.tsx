// Менеджеры и их доступы (право users.manage; матрица прав — только супер-админ).
// Список менеджеров (getUsers, фильтр role='manager'): у каждого — галочки участков
// (PUT /users/:id/sites, право access.manage) и, для супер-админа, галочки прав
// (PUT /users/:id/permissions). Форма создания менеджера — по «+» в заголовке секции
// (showForm), логин генерируется транслитом ФИО, пароль — автогенератором, как в
// EmployeeAdmin. Архив обратим: archiveUser / restoreUser.

import React from 'react';
import {
  Archive,
  ArchiveRestore,
  Copy,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import * as api from '../../lib/gsmApi';
import { ApiError } from '../../lib/gsmApi';
import type { AdminUser, Permission, Site, User } from '../../lib/gsmTypes';
import { ALL_PERMISSIONS, PERMISSION_LABELS } from '../../lib/gsmTypes';
import { translitLogin } from '../../lib/translit';
import { genPassword } from '../../lib/genPassword';
import { useRemoteList } from '../../lib/useRemoteList';

export interface UserAdminProps {
  // Текущий пользователь — по нему решаем, показывать ли матрицу прав
  // и разрешено ли править доступы к участкам.
  currentUser: User;
  // Активные участки — опции галочек доступа.
  sites: Site[];
  // Показывать форму создания менеджера (кнопка «+» в заголовке секции).
  showForm?: boolean;
}

// ivanov-p → ivanov-p2 → ivanov-p3 (на 409 username_taken).
function nextLogin(login: string): string {
  const m = login.match(/^(.*?)(\d+)$/);
  if (!m) return `${login}2`;
  return `${m[1]}${Number(m[2]) + 1}`;
}

const MAX_LOGIN_ATTEMPTS = 5;

const UserAdmin: React.FC<UserAdminProps> = ({
  currentUser,
  sites,
  showForm = false,
}) => {
  // В списке ведём только менеджеров: механики — в соседней вкладке (EmployeeAdmin).
  const {
    data: users,
    error: listError,
    refetch,
  } = useRemoteList(
    React.useCallback(
      () => api.getUsers().then((list) => list.filter((u) => u.role === 'manager')),
      [],
    ),
  );
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [rowError, setRowError] = React.useState<{ id: number; msg: string } | null>(
    null,
  );

  // Форма создания менеджера.
  const [fullName, setFullName] = React.useState('');
  const [password, setPassword] = React.useState(genPassword);
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const isSuperadmin = currentUser.role === 'superadmin';
  const canEditAccess = currentUser.permissions.includes('access.manage');

  const login = React.useMemo(() => translitLogin(fullName), [fullName]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!fullName.trim() || !login) {
      setFormError('Введите ФИО.');
      return;
    }
    setSubmitting(true);
    try {
      let attempt = login;
      for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i += 1) {
        try {
          await api.createManager({
            username: attempt,
            password,
            displayName: fullName.trim(),
            siteIds: [],
          });
          setFullName('');
          setPassword(genPassword());
          await refetch();
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            attempt = nextLogin(attempt);
            continue;
          }
          throw err;
        }
      }
      setFormError('Логин занят — измените ФИО.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setFormError('Проверьте поля: ФИО и пароль (мин. 6 символов).');
      } else if (err instanceof ApiError && err.status === 403) {
        setFormError('Недостаточно прав для создания менеджера.');
      } else {
        setFormError('Не удалось создать менеджера. Попробуйте позже.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onCopy = async () => {
    await navigator.clipboard.writeText(`Логин: ${login}\nПароль: ${password}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  // Общий раннер операций над строкой: занятость, сообщение об ошибке, рефетч.
  const runRowAction = async (id: number, action: () => Promise<void>, msg: string) => {
    setBusyId(id);
    setRowError(null);
    try {
      await action();
      await refetch();
    } catch (err) {
      const text =
        err instanceof ApiError && err.status === 403
          ? 'Недостаточно прав для этого действия.'
          : msg;
      setRowError({ id, msg: text });
    } finally {
      setBusyId(null);
    }
  };

  const toggleSite = (u: AdminUser, siteId: number) => {
    const next = u.siteIds.includes(siteId)
      ? u.siteIds.filter((s) => s !== siteId)
      : [...u.siteIds, siteId];
    void runRowAction(
      u.id,
      () => api.setUserSites(u.id, next),
      'Не удалось изменить доступы к участкам.',
    );
  };

  const togglePermission = (u: AdminUser, permission: Permission) => {
    const next = u.permissions.includes(permission)
      ? u.permissions.filter((p) => p !== permission)
      : [...u.permissions, permission];
    void runRowAction(
      u.id,
      () => api.setUserPermissions(u.id, next),
      'Не удалось изменить права.',
    );
  };

  return (
    <div className="space-y-4">
      {showForm && (
        <form
          onSubmit={onCreate}
          className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className="resource-label">ФИО менеджера</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="off"
                className="resource-input text-sm"
                placeholder="Иванов Иван Иванович"
              />
            </div>
            <div>
              <label className="resource-label">Логин</label>
              <input
                type="text"
                value={login}
                readOnly
                className="resource-input bg-white text-sm text-gray-500"
              />
            </div>
            <div>
              <label className="resource-label">Пароль</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={password}
                  readOnly
                  className="resource-input bg-white text-sm text-gray-500"
                />
                <button
                  type="button"
                  onClick={() => setPassword(genPassword())}
                  title="Сгенерировать другой"
                  className="p-2 text-gray-400 transition-colors hover:text-gray-900"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => void onCopy()}
                disabled={!login}
                title="Скопировать логин и пароль"
                className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold uppercase tracking-widest text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-50"
              >
                <Copy className="w-4 h-4" />
                {copied ? 'Скопировано' : 'Копировать'}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-5 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-black disabled:opacity-50"
              >
                Создать
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            Участки и права выдаются галочками в списке ниже — новый менеджер создаётся
            без доступов.
          </p>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
        </form>
      )}

      <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {users === null && !listError && (
          <div className="flex items-center gap-2 px-4 py-5 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Загрузка…
          </div>
        )}
        {listError && (
          <p className="px-4 py-5 text-xs text-red-500">Не удалось загрузить список.</p>
        )}
        {users !== null && users.length === 0 && !listError && (
          <p className="px-4 py-5 text-xs text-gray-400">Менеджеров пока нет.</p>
        )}
        {users?.map((u) => {
          const archived = !u.active;
          const isSelf = u.id === currentUser.id;
          return (
            <div key={u.id} className={archived ? 'opacity-50' : ''}>
              <div className="space-y-3 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <ShieldCheck
                      className={`w-4 h-4 shrink-0 ${
                        archived ? 'text-gray-300' : 'text-gray-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <p
                        className={`truncate text-sm font-bold ${
                          archived ? 'text-gray-400' : 'text-gray-900'
                        }`}
                      >
                        {u.displayName || u.username}
                        {isSelf && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                            это вы
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[11px] text-gray-400">
                        логин: {u.username}
                        {archived && ' · в архиве'}
                      </p>
                    </div>
                  </div>

                  {!isSelf &&
                    (archived ? (
                      <button
                        type="button"
                        onClick={() =>
                          void runRowAction(
                            u.id,
                            () => api.restoreUser(u.id),
                            'Не удалось восстановить менеджера.',
                          )
                        }
                        disabled={busyId === u.id}
                        title="Восстановить"
                        className="p-2 text-gray-400 transition-colors hover:text-gray-900 disabled:opacity-50"
                      >
                        {busyId === u.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ArchiveRestore className="w-4 h-4" />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void runRowAction(
                            u.id,
                            () => api.archiveUser(u.id),
                            'Не удалось архивировать менеджера.',
                          )
                        }
                        disabled={busyId === u.id}
                        title="Архивировать"
                        className="p-2 text-gray-300 transition-colors hover:text-gray-700 disabled:opacity-50"
                      >
                        {busyId === u.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Archive className="w-4 h-4" />
                        )}
                      </button>
                    ))}
                </div>

                {/* Доступ к участкам — галочки (право access.manage). */}
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    Доступ к участкам
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {sites.length === 0 && (
                      <span className="text-[11px] text-gray-400">Участков нет.</span>
                    )}
                    {sites.map((site) => (
                      <label
                        key={site.id}
                        className="flex items-center gap-1.5 text-xs text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={u.siteIds.includes(site.id)}
                          disabled={!canEditAccess || busyId === u.id}
                          onChange={() => toggleSite(u, site.id)}
                          className="h-3.5 w-3.5 rounded border-gray-300 accent-gray-900 disabled:opacity-40"
                        />
                        {site.name}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Матрица прав — только супер-админ. */}
                {isSuperadmin && (
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Права на редактирование
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {ALL_PERMISSIONS.map((permission) => (
                        <label
                          key={permission}
                          className="flex items-center gap-1.5 text-xs text-gray-700"
                        >
                          <input
                            type="checkbox"
                            checked={u.permissions.includes(permission)}
                            disabled={busyId === u.id}
                            onChange={() => togglePermission(u, permission)}
                            className="h-3.5 w-3.5 rounded border-gray-300 accent-gray-900 disabled:opacity-40"
                          />
                          {PERMISSION_LABELS[permission]}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {rowError?.id === u.id && (
                <p className="px-4 pb-3 text-[11px] text-red-500">{rowError.msg}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UserAdmin;
