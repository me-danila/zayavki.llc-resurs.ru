// Управление участками (manager). Список (getSites): активные сверху обычные с
// кнопкой «Архивировать», архивные ниже — замьючены с «Восстановить». Форма создания
// (поле «Название участка» + «Добавить» → createSite; 409 → «Участок уже есть»,
// 400 → «Введите название»). archiveSite: 409 → причина (has_stock / has_workers).
// Все операции рефетчат список и уведомляют родителя (onChanged) — чтобы он обновил
// список активных участков для ReceiptForm/EmployeeAdmin.

import React from 'react';
import {
  Archive,
  ArchiveRestore,
  Loader2,
  MapPin,
  Plus,
} from 'lucide-react';
import * as api from '../../lib/gsmApi';
import { ApiError } from '../../lib/gsmApi';
import type { Site } from '../../lib/gsmTypes';

export interface SiteAdminProps {
  // Вызывается после любого успешного изменения участков (create/archive/restore),
  // чтобы родитель перезагрузил список активных участков для форм.
  onChanged?: () => void;
  // Показывать форму создания участка. По умолчанию скрыта — список виден всегда,
  // форма раскрывается кнопкой «+» в заголовке секции (родитель управляет).
  showForm?: boolean;
}

// Текст причины отказа архивации по коду ошибки (тело 409 {error}).
function archiveReason(error: unknown): string {
  if (error === 'has_stock') {
    return 'На участке есть остатки — сначала спишите/обнулите.';
  }
  if (error === 'has_workers') {
    return 'К участку привязаны сотрудники — переназначьте/архивируйте их.';
  }
  return 'Не удалось архивировать участок.';
}

const SiteAdmin: React.FC<SiteAdminProps> = ({ onChanged, showForm = false }) => {
  const [sites, setSites] = React.useState<Site[] | null>(null);
  const [listError, setListError] = React.useState(false);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [rowError, setRowError] = React.useState<{ id: number; msg: string } | null>(
    null
  );

  // Форма создания.
  const [name, setName] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    setListError(false);
    try {
      const list = await api.getSites();
      setSites(list);
    } catch {
      setListError(true);
    }
  }, []);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Введите название участка.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createSite(trimmed);
      setName('');
      await refetch();
      onChanged?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFormError('Участок уже есть.');
      } else if (err instanceof ApiError && err.status === 400) {
        setFormError('Введите название участка.');
      } else {
        setFormError('Не удалось добавить участок. Попробуйте позже.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onArchive = async (id: number) => {
    setBusyId(id);
    setRowError(null);
    try {
      await api.archiveSite(id);
      await refetch();
      onChanged?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { error?: unknown } | null;
        setRowError({ id, msg: archiveReason(body?.error) });
      } else {
        setRowError({ id, msg: 'Не удалось архивировать участок.' });
      }
    } finally {
      setBusyId(null);
    }
  };

  const onRestore = async (id: number) => {
    setBusyId(id);
    setRowError(null);
    try {
      await api.restoreSite(id);
      await refetch();
      onChanged?.();
    } catch {
      setRowError({ id, msg: 'Не удалось восстановить участок.' });
    } finally {
      setBusyId(null);
    }
  };

  // Активные сверху, архивные ниже (бэк уже сортирует, подстрахуемся).
  const sorted = React.useMemo(() => {
    if (!sites) return null;
    const active = sites.filter((s) => s.active);
    const archived = sites.filter((s) => !s.active);
    return [...active, ...archived];
  }, [sites]);

  return (
    <div className="space-y-4">
      {/* Форма создания — только по «+» (showForm) */}
      {showForm && (
      <form
        onSubmit={onCreate}
        className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="resource-label">Название участка</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className="resource-input text-sm"
              placeholder="Напр. Северный"
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

      {/* Список участков */}
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
          <p className="px-4 py-5 text-xs text-gray-400">Участков пока нет.</p>
        )}
        {sorted?.map((s) => {
          const archived = !s.active;
          const hasError = rowError?.id === s.id;
          return (
            <div key={s.id} className={archived ? 'opacity-50' : ''}>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <MapPin
                    className={`w-4 h-4 shrink-0 ${
                      archived ? 'text-gray-300' : 'text-gray-400'
                    }`}
                  />
                  <span
                    className={`truncate text-sm font-bold ${
                      archived ? 'text-gray-400' : 'text-gray-900'
                    }`}
                  >
                    {s.name}
                  </span>
                  {archived && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">
                      в архиве
                    </span>
                  )}
                </div>

                {archived ? (
                  <button
                    type="button"
                    onClick={() => onRestore(s.id)}
                    disabled={busyId === s.id}
                    title="Восстановить"
                    className="p-2 text-gray-400 transition-colors hover:text-gray-900 disabled:opacity-50"
                  >
                    {busyId === s.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ArchiveRestore className="w-4 h-4" />
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onArchive(s.id)}
                    disabled={busyId === s.id}
                    title="Архивировать"
                    className="p-2 text-gray-300 transition-colors hover:text-gray-700 disabled:opacity-50"
                  >
                    {busyId === s.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Archive className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
              {hasError && (
                <p className="px-4 pb-3 text-[11px] text-red-500">{rowError?.msg}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SiteAdmin;
