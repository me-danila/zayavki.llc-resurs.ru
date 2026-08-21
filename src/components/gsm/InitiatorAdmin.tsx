// Справочник инициаторов заявки (право initiators.manage). Раньше был хардкодом
// src/data/initiatorData.tsx; теперь живёт в БД и подставляется в форму заявки на «/».
// Список: активные сверху, архивные замьючены. Строка правится инлайн (ФИО + должность),
// удаление — архивирование (обратимо).

import React from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  Loader2,
  Pencil,
  Plus,
  User as UserIcon,
  X,
} from 'lucide-react';
import * as api from '../../lib/gsmApi';
import { ApiError } from '../../lib/gsmApi';
import { useRemoteList } from '../../lib/useRemoteList';

export interface InitiatorAdminProps {
  // Показывать форму добавления (кнопка «+» в заголовке секции).
  showForm?: boolean;
}

const InitiatorAdmin: React.FC<InitiatorAdminProps> = ({ showForm = false }) => {
  const {
    data: items,
    error: listError,
    refetch,
  } = useRemoteList(React.useCallback(() => api.getInitiators(), []));
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [rowError, setRowError] = React.useState<{ id: number; msg: string } | null>(
    null,
  );

  // Инлайн-правка строки.
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editName, setEditName] = React.useState('');
  const [editPosition, setEditPosition] = React.useState('');

  // Форма добавления.
  const [name, setName] = React.useState('');
  const [position, setPosition] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !position.trim()) {
      setFormError('Заполните ФИО и должность.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createInitiator({ name: name.trim(), position: position.trim() });
      setName('');
      setPosition('');
      await refetch();
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.status === 409
          ? 'Такой инициатор уже есть.'
          : 'Не удалось добавить инициатора.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const runRowAction = async (id: number, action: () => Promise<void>, msg: string) => {
    setBusyId(id);
    setRowError(null);
    try {
      await action();
      await refetch();
    } catch (err) {
      setRowError({
        id,
        msg:
          err instanceof ApiError && err.status === 409
            ? 'Такой инициатор уже есть.'
            : msg,
      });
    } finally {
      setBusyId(null);
    }
  };

  const onSaveEdit = async (id: number) => {
    if (!editName.trim() || !editPosition.trim()) {
      setRowError({ id, msg: 'ФИО и должность не могут быть пустыми.' });
      return;
    }
    await runRowAction(
      id,
      async () => {
        await api.updateInitiator(id, {
          name: editName.trim(),
          position: editPosition.trim(),
        });
        setEditingId(null);
      },
      'Не удалось сохранить изменения.',
    );
  };

  return (
    <div className="space-y-4">
      {showForm && (
        <form
          onSubmit={onCreate}
          className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="resource-label">ФИО</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                className="resource-input text-sm"
                placeholder="Иванов Иван Иванович"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="resource-label">Должность</label>
              <input
                type="text"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                autoComplete="off"
                className="resource-input text-sm"
                placeholder="Механик"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-5 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-black disabled:opacity-50"
            >
              Добавить
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </button>
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
        </form>
      )}

      <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {items === null && !listError && (
          <div className="flex items-center gap-2 px-4 py-5 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Загрузка…
          </div>
        )}
        {listError && (
          <p className="px-4 py-5 text-xs text-red-500">Не удалось загрузить список.</p>
        )}
        {items !== null && items.length === 0 && !listError && (
          <p className="px-4 py-5 text-xs text-gray-400">Инициаторов пока нет.</p>
        )}
        {items?.map((it) => {
          const archived = !it.active;
          const editing = editingId === it.id;
          return (
            <div key={it.id} className={archived ? 'opacity-50' : ''}>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <UserIcon
                    className={`w-4 h-4 shrink-0 ${
                      archived ? 'text-gray-300' : 'text-gray-400'
                    }`}
                  />
                  {editing ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={editName}
                        autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                        className="resource-input h-8 flex-1 text-sm"
                      />
                      <input
                        type="text"
                        value={editPosition}
                        onChange={(e) => setEditPosition(e.target.value)}
                        className="resource-input h-8 flex-1 text-sm"
                      />
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <p
                        className={`truncate text-sm font-bold ${
                          archived ? 'text-gray-400' : 'text-gray-900'
                        }`}
                      >
                        {it.name}
                      </p>
                      <p className="truncate text-[11px] text-gray-400">
                        {it.position}
                        {archived && ' · в архиве'}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void onSaveEdit(it.id)}
                        disabled={busyId === it.id}
                        title="Сохранить"
                        className="p-2 text-gray-400 transition-colors hover:text-gray-900 disabled:opacity-50"
                      >
                        {busyId === it.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        title="Отмена"
                        className="p-2 text-gray-300 transition-colors hover:text-gray-700"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : archived ? (
                    <button
                      type="button"
                      onClick={() =>
                        void runRowAction(
                          it.id,
                          () => api.restoreInitiator(it.id),
                          'Не удалось восстановить инициатора.',
                        )
                      }
                      disabled={busyId === it.id}
                      title="Восстановить"
                      className="p-2 text-gray-400 transition-colors hover:text-gray-900 disabled:opacity-50"
                    >
                      {busyId === it.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ArchiveRestore className="w-4 h-4" />
                      )}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(it.id);
                          setEditName(it.name);
                          setEditPosition(it.position);
                          setRowError(null);
                        }}
                        title="Изменить"
                        className="p-2 text-gray-300 transition-colors hover:text-gray-700"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void runRowAction(
                            it.id,
                            () => api.archiveInitiator(it.id),
                            'Не удалось архивировать инициатора.',
                          )
                        }
                        disabled={busyId === it.id}
                        title="Архивировать"
                        className="p-2 text-gray-300 transition-colors hover:text-gray-700 disabled:opacity-50"
                      >
                        {busyId === it.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Archive className="w-4 h-4" />
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {rowError?.id === it.id && (
                <p className="px-4 pb-3 text-[11px] text-red-500">{rowError.msg}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default InitiatorAdmin;
