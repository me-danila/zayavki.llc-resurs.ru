// Управление воркерами (manager). Дизайн-правки этого раунда.
// Список: активные сверху (обычные, иконка «Архивировать» Archive → deleteEmployee),
// архивные ниже (замьючены, иконка «Восстановить» ArchiveRestore → restoreEmployee).
// Каждая строка: имя, «логин: <username>», участок. Рефетч после действий.
// Форма «Новый сотрудник» скрыта по умолчанию (showForm контролит ManagerPage через
// кнопку-плюс в заголовке секции). На десктопе форма — одна строка (flex, без переноса):
// ФИО (обязат.) → логин (readonly, автоген translitLogin(ФИО)) → пароль (readonly,
// автоген genPassword()) → «обновить» (regenerate) → «копировать» креды → «Добавить».
// При 409 — инкремент числового суффикса логина, повтор (до 5 попыток).
// Роль воркера форсится бэком — здесь не передаётся.
// v5: строку можно править инлайн (ФИО, участок, сброс пароля) — PATCH /users/:id.
// Смена участка требует права access.manage, поэтому поле участка при его отсутствии
// заблокировано (сервер всё равно ответит 403).

import React from 'react';
import {
  Archive,
  ArchiveRestore,
  Copy,
  Check,
  Pencil,
  RefreshCw,
  UserPlus,
  Loader2,
  X,
} from 'lucide-react';
import * as api from '../../lib/gsmApi';
import { ApiError } from '../../lib/gsmApi';
import type { Employee } from '../../lib/gsmTypes';
import { Combobox } from '../ui/Combobox';
import { translitLogin } from '../../lib/translit';
import { genPassword } from '../../lib/genPassword';
import { useRemoteList } from '../../lib/useRemoteList';

export interface EmployeeAdminProps {
  showForm: boolean;
  // Активные участки — опции комбобокса и источник для name→siteId.
  sites: Array<{ id: number; name: string }>;
  // Разрешено ли менять участок сотрудника (право access.manage).
  canEditSite?: boolean;
}

// Инкремент числового суффикса логина при коллизии: ivanov-p → ivanov-p2 → ivanov-p3.
function nextLogin(login: string): string {
  const m = login.match(/^(.*?)(\d+)$/);
  if (m) {
    const base = m[1];
    const num = Number(m[2]) + 1;
    return `${base}${num}`;
  }
  return `${login}2`;
}

const EmployeeAdmin: React.FC<EmployeeAdminProps> = ({
  showForm,
  sites,
  canEditSite = false,
}) => {
  const {
    data: employees,
    error: listError,
    setError: setListError,
    refetch,
  } = useRemoteList(React.useCallback(() => api.getEmployees(), []));
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [rowError, setRowError] = React.useState<{ id: number; msg: string } | null>(
    null,
  );

  // Инлайн-правка строки: ФИО, участок и (опционально) новый пароль.
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editName, setEditName] = React.useState('');
  const [editSite, setEditSite] = React.useState('');
  const [editPassword, setEditPassword] = React.useState('');

  // Поля формы (контролируемые — без react-hook-form, т.к. логин/пароль автогенятся).
  const [fio, setFio] = React.useState('');
  const [site, setSite] = React.useState('');
  // Пароль не пустой с самого начала (lazy-init) — отдельный effect не нужен.
  const [password, setPassword] = React.useState<string>(() => genPassword());
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [okMessage, setOkMessage] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Логин derive из ФИО (live).
  const login = React.useMemo(() => translitLogin(fio), [fio]);

  // Опции комбобокса участка + маппинг имя→siteId (по активным участкам).
  const siteOptions = React.useMemo(() => sites.map((s) => s.name), [sites]);
  const siteIdByName = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sites) m.set(s.name.trim(), s.id);
    return m;
  }, [sites]);

  const regenerate = () => {
    setPassword(genPassword());
    setCopied(false);
  };

  const copyCreds = async () => {
    try {
      await navigator.clipboard.writeText(`Логин: ${login}\nПароль: ${password}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // буфер недоступен — молча игнорируем
    }
  };

  const resetForm = () => {
    setFio('');
    setSite('');
    setPassword(genPassword());
    setCopied(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setOkMessage(null);

    const trimmedFio = fio.trim();
    if (!trimmedFio || !login) {
      setFormError('Введите ФИО.');
      return;
    }
    const siteId = siteIdByName.get(site.trim());
    if (!site || siteId === undefined) {
      setFormError('Выберите участок из списка.');
      return;
    }

    setSubmitting(true);
    let candidate = login;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await api.createEmployee({
            username: candidate,
            password,
            displayName: trimmedFio,
            siteId,
          });
          setOkMessage(`✓ добавлен: ${candidate}`);
          resetForm();
          await refetch();
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            // Логин занят — инкрементим суффикс и пробуем снова.
            candidate = nextLogin(candidate);
            continue;
          }
          throw err;
        }
      }
      setFormError('Логин занят, не удалось подобрать свободный. Измените ФИО.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setFormError('Проверьте поля: ФИО, участок и пароль (мин. 6).');
      } else {
        setFormError('Не удалось добавить сотрудника. Попробуйте позже.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Сохранение инлайн-правки: ФИО, участок (если разрешено) и/или новый пароль.
  const onSaveEdit = async (id: number) => {
    const name = editName.trim();
    if (!name) {
      setRowError({ id, msg: 'ФИО не может быть пустым.' });
      return;
    }
    const patch: { displayName?: string; siteId?: number; password?: string } = {
      displayName: name,
    };
    if (canEditSite && editSite.trim()) {
      const siteId = siteIdByName.get(editSite.trim());
      if (!siteId) {
        setRowError({ id, msg: 'Выберите участок из списка.' });
        return;
      }
      patch.siteId = siteId;
    }
    if (editPassword) {
      if (editPassword.length < 6) {
        setRowError({ id, msg: 'Пароль — минимум 6 символов.' });
        return;
      }
      patch.password = editPassword;
    }

    setBusyId(id);
    setRowError(null);
    try {
      await api.updateUser(id, patch);
      setEditingId(null);
      setEditPassword('');
      await refetch();
    } catch (err) {
      setRowError({
        id,
        msg:
          err instanceof ApiError && err.status === 403
            ? 'Недостаточно прав для этого изменения.'
            : 'Не удалось сохранить изменения.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const onArchive = async (id: number) => {
    setBusyId(id);
    try {
      await api.deleteEmployee(id);
      await refetch();
    } catch {
      setListError(true);
    } finally {
      setBusyId(null);
    }
  };

  const onRestore = async (id: number) => {
    setBusyId(id);
    try {
      await api.restoreEmployee(id);
      await refetch();
    } catch {
      setListError(true);
    } finally {
      setBusyId(null);
    }
  };

  const nameOf = (e: Employee): string => e.displayName || e.username;

  // Активные сверху, архивные ниже (бэк уже сортирует, но подстрахуемся).
  const sorted = React.useMemo(() => {
    if (!employees) return null;
    const active = employees.filter((e) => e.active);
    const archived = employees.filter((e) => !e.active);
    return [...active, ...archived];
  }, [employees]);

  return (
    <div className="space-y-4">
      {/* Форма добавления — раскрывается по «+» в заголовке секции */}
      {showForm && (
        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
        >
          <div className="flex items-center gap-2 text-gray-700">
            <UserPlus className="w-4 h-4 text-gray-400" />
            <h3 className="text-xs font-bold uppercase tracking-wide">Новый сотрудник</h3>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap lg:flex-nowrap sm:items-end gap-3">
            {/* ФИО */}
            <div className="flex-1 min-w-[160px]">
              <label className="resource-label">ФИО</label>
              <input
                type="text"
                value={fio}
                onChange={(e) => setFio(e.target.value)}
                autoComplete="off"
                className="resource-input text-sm"
                placeholder="Иванов Пётр"
              />
            </div>

            {/* Участок */}
            <div className="flex-1 min-w-[150px]">
              <label className="resource-label">Участок</label>
              <Combobox
                options={siteOptions}
                value={site}
                onChange={setSite}
                placeholder="Выбор участка..."
                allowCustom={false}
              />
            </div>

            {/* Логин (readonly, автоген) */}
            <div className="flex-1 min-w-[130px]">
              <label className="resource-label">Логин</label>
              <input
                type="text"
                value={login}
                readOnly
                tabIndex={-1}
                className="resource-input text-sm bg-gray-100 text-gray-600"
                placeholder="из ФИО"
              />
            </div>

            {/* Пароль (readonly, автоген) */}
            <div className="flex-1 min-w-[120px]">
              <label className="resource-label">Пароль</label>
              <input
                type="text"
                value={password}
                readOnly
                tabIndex={-1}
                className="resource-input text-sm bg-gray-100 text-gray-600 font-mono"
                placeholder="—"
              />
            </div>

            {/* Кнопки: обновить, копировать, добавить */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={regenerate}
                title="Сгенерировать новый пароль"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:text-gray-900 hover:border-gray-300"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={copyCreds}
                disabled={!login || !password}
                title="Скопировать логин и пароль"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:text-gray-900 hover:border-gray-300 disabled:opacity-40"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-5 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-black disabled:opacity-50"
              >
                Добавить
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {formError && <p className="text-xs text-red-500">{formError}</p>}
          {okMessage && <p className="text-xs text-green-600">{okMessage}</p>}
        </form>
      )}

      {/* Список сотрудников */}
      <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {sorted === null && !listError && (
          <div className="flex items-center gap-2 px-4 py-5 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Загрузка…
          </div>
        )}
        {listError && (
          <p className="px-4 py-5 text-xs text-red-500">Не удалось загрузить список.</p>
        )}
        {sorted !== null && sorted.length === 0 && !listError && (
          <p className="px-4 py-5 text-xs text-gray-400">Сотрудников пока нет.</p>
        )}
        {sorted?.map((e) => {
          const archived = !e.active;
          return (
            <div key={e.id} className={archived ? 'opacity-50' : ''}>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                {editingId === e.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editName}
                      autoFocus
                      onChange={(ev) => setEditName(ev.target.value)}
                      placeholder="ФИО"
                      className="resource-input h-8 w-full text-sm"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="flex-1">
                        <Combobox
                          options={siteOptions}
                          value={editSite}
                          onChange={setEditSite}
                          allowCustom={false}
                          disabled={!canEditSite}
                          placeholder={
                            canEditSite ? 'Участок…' : 'Смена участка недоступна'
                          }
                        />
                      </div>
                      <input
                        type="text"
                        value={editPassword}
                        onChange={(ev) => setEditPassword(ev.target.value)}
                        placeholder="Новый пароль (не обязательно)"
                        className="resource-input h-8 flex-1 text-sm"
                      />
                    </div>
                    <p className="text-[11px] text-gray-400">логин: {e.username}</p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span
                        className={`text-sm font-bold ${
                          archived ? 'text-gray-400' : 'text-gray-900'
                        }`}
                      >
                        {nameOf(e)}
                      </span>
                      {archived && (
                        <span className="text-[10px] uppercase tracking-wide text-gray-400">
                          в архиве
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      логин: {e.username}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Участок: {e.siteName ?? '—'}
                    </div>
                  </>
                )}
              </div>

              {editingId === e.id ? (
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => void onSaveEdit(e.id)}
                    disabled={busyId === e.id}
                    title="Сохранить"
                    className="p-2 text-gray-400 transition-colors hover:text-gray-900 disabled:opacity-50"
                  >
                    {busyId === e.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setEditPassword('');
                    }}
                    title="Отмена"
                    className="p-2 text-gray-300 transition-colors hover:text-gray-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : archived ? (
                <button
                  type="button"
                  onClick={() => onRestore(e.id)}
                  disabled={busyId === e.id}
                  title="Восстановить"
                  className="p-2 text-gray-400 transition-colors hover:text-gray-900 disabled:opacity-50"
                >
                  {busyId === e.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArchiveRestore className="w-4 h-4" />
                  )}
                </button>
              ) : (
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(e.id);
                      setEditName(e.displayName ?? '');
                      setEditSite(e.siteName ?? '');
                      setEditPassword('');
                      setRowError(null);
                    }}
                    title="Изменить"
                    className="p-2 text-gray-300 transition-colors hover:text-gray-700"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onArchive(e.id)}
                    disabled={busyId === e.id}
                    title="Архивировать"
                    className="p-2 text-gray-300 transition-colors hover:text-gray-700 disabled:opacity-50"
                  >
                    {busyId === e.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Archive className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}
            </div>
            {rowError?.id === e.id && (
              <p className="px-4 pb-3 text-[11px] text-red-500">{rowError.msg}</p>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EmployeeAdmin;
