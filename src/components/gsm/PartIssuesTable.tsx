// Журнал расхода штучных материалов для менеджера: фильтры, таблица, выгрузка xlsx,
// правка и отмена строки, перенос выбранных записей в 1С.
//
// Статус — три взаимоисключающих состояния: «актуален» (в работе), «списан в 1С»
// (архив) и «отменён». По умолчанию открывается «актуален», чтобы менеджер видел
// только то, что ещё предстоит занести в 1С.
//
// Массово переносим в 1С, а возвращаем обратно только поштучно — из меню строки:
// возврат из архива штучная операция, пачкой её делать незачем.
//
// Отменённые строки не прячем — показываем зачёркнутыми: менеджеру важно видеть,
// что запись была и кто её отменил. У исправленных под строкой видно «было».
// Сервер отдаёт только доступные участки, дополнительно на клиенте не режем.

import React from 'react';
import { Download, Loader2, Pencil, Ban, Search, Upload, RotateCcw } from 'lucide-react';
import * as api from '../../lib/gsmApi';
import { ApiError } from '../../lib/gsmApi';
import type { PartIssue, PartIssueFilter, PartIssueStatus, Site } from '../../lib/gsmTypes';
import { LICENSE_PLATES } from '../../data/licenceNumberData';
import { formatRu } from '../../lib/gsmDates';
import { Combobox } from '../ui/Combobox';
import Modal from './Modal';
import DotsMenu from './DotsMenu';

export interface PartIssuesTableProps {
  // Участки в области видимости менеджера — опции фильтра.
  sites: Site[];
}

// Черновик правки: строковые поля, чтобы не спорить с пустым вводом.
type EditDraft = {
  issueDate: string;
  partNumber: string;
  name: string;
  qty: string;
  licensePlate: string;
  recipient: string;
  comment: string;
};

function draftFrom(issue: PartIssue): EditDraft {
  return {
    issueDate: issue.issueDate,
    partNumber: issue.partNumber,
    name: issue.name,
    qty: String(issue.qty),
    licensePlate: issue.licensePlate,
    recipient: issue.recipient,
    comment: issue.comment ?? '',
  };
}

function authorName(a: { username: string; displayName: string | null }): string {
  return a.displayName || a.username;
}

// Стартовый фильтр: показываем то, что ещё не занесено в 1С.
const DEFAULT_FILTER: PartIssueFilter = { status: 'actual' };

const STATUS_OPTIONS: Array<{ value: PartIssueStatus; label: string }> = [
  { value: 'actual', label: 'Актуален' },
  { value: 'exported', label: 'Списан в 1С' },
  { value: 'voided', label: 'Отменён' },
  { value: 'all', label: 'Все' },
];

const PartIssuesTable: React.FC<PartIssuesTableProps> = ({ sites }) => {
  const [filter, setFilter] = React.useState<PartIssueFilter>(DEFAULT_FILTER);
  const [issues, setIssues] = React.useState<PartIssue[] | null>(null);
  const [listError, setListError] = React.useState(false);

  const [editing, setEditing] = React.useState<PartIssue | null>(null);
  const [draft, setDraft] = React.useState<EditDraft | null>(null);
  const [voiding, setVoiding] = React.useState<PartIssue | null>(null);
  // Выбранные строки для переноса в 1С. Отменённые выбирать нельзя.
  const [selected, setSelected] = React.useState<number[]>([]);
  // Подтверждение массового списания выбранных строк в 1С.
  const [confirmExport, setConfirmExport] = React.useState(false);
  // Возврат из архива — поштучно, отдельной строкой из её меню.
  const [unmarking, setUnmarking] = React.useState<PartIssue | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const load = React.useCallback(async (f: PartIssueFilter) => {
    try {
      setIssues(await api.getPartIssues(f));
      setListError(false);
    } catch {
      setListError(true);
    }
    // Список пересобран — прежние id могли из него уйти, выделение сбрасываем.
    setSelected([]);
  }, []);

  // Первичная загрузка и перезапрос при смене фильтра. setState только в колбэках
  // промиса (react-hooks/set-state-in-effect), alive отсекает устаревшие ответы.
  React.useEffect(() => {
    let alive = true;
    api.getPartIssues(filter).then(
      (list) => {
        if (!alive) return;
        setIssues(list);
        setListError(false);
        setSelected([]);
      },
      () => {
        if (alive) setListError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [filter]);

  const patchFilter = (patch: Partial<PartIssueFilter>) =>
    setFilter((prev) => ({ ...prev, ...patch }));

  const total = React.useMemo(
    () => (issues ?? []).filter((i) => !i.voided).reduce((s, i) => s + i.qty, 0),
    [issues],
  );

  // Выбирать можно только рабочие строки: отменённые в 1С не переносят,
  // а списанные возвращают поштучно через меню строки.
  const selectable = React.useMemo(
    () => (issues ?? []).filter((i) => !i.voided && !i.exported),
    [issues],
  );
  const selectedIssues = React.useMemo(
    () => (issues ?? []).filter((i) => selected.includes(i.id)),
    [issues, selected],
  );
  const allSelected =
    selectable.length > 0 && selectable.every((i) => selected.includes(i.id));

  const toggleRow = (id: number) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  const toggleAll = () =>
    setSelected(allSelected ? [] : selectable.map((i) => i.id));

  // Перенос выбранных в 1С. Выбрать можно только рабочие строки, так что
  // фильтровать список повторно не нужно — сервер отбивает отменённые сам.
  const onExport = async () => {
    const ids = selectedIssues.map((i) => i.id);
    if (!ids.length) {
      setConfirmExport(false);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.setPartIssuesExported(ids, true);
      setConfirmExport(false);
      await load(filter);
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.status === 409
          ? 'Отменённые записи в 1С не переносятся.'
          : 'Не удалось списать в 1С.',
      );
    } finally {
      setBusy(false);
    }
  };

  // Возврат одной записи из архива в актуальные.
  const onUnmark = async () => {
    if (!unmarking) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.setPartIssuesExported([unmarking.id], false);
      setUnmarking(null);
      await load(filter);
    } catch {
      setActionError('Не удалось вернуть запись в актуальные.');
    } finally {
      setBusy(false);
    }
  };

  const onSaveEdit = async () => {
    if (!editing || !draft) return;
    const qty = Number(draft.qty);
    if (
      !draft.partNumber.trim() ||
      !draft.name.trim() ||
      !Number.isInteger(qty) ||
      qty <= 0 ||
      !draft.licensePlate.trim() ||
      !draft.recipient.trim()
    ) {
      setActionError('Заполните все поля, количество — целое число больше нуля.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.correctPartIssue(editing.id, {
        action: 'edit',
        issueDate: draft.issueDate,
        partNumber: draft.partNumber.trim(),
        name: draft.name.trim(),
        qty,
        licensePlate: draft.licensePlate.trim(),
        recipient: draft.recipient.trim(),
        comment: draft.comment.trim() ? draft.comment.trim() : null,
      });
      setEditing(null);
      setDraft(null);
      await load(filter);
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.status === 409
          ? 'Запись уже отменена — править нельзя.'
          : 'Не удалось сохранить правку.',
      );
    } finally {
      setBusy(false);
    }
  };

  const onVoid = async () => {
    if (!voiding) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.correctPartIssue(voiding.id, { action: 'void' });
      setVoiding(null);
      await load(filter);
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.status === 409
          ? 'Запись уже отменена.'
          : 'Не удалось отменить запись.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Фильтры */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2">
          <label className="resource-label">Поиск</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-300" />
            <input
              type="text"
              value={filter.search ?? ''}
              onChange={(e) => patchFilter({ search: e.target.value })}
              placeholder="Деталь, наименование, номер, получатель, комментарий…"
              className="resource-input pl-9 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="resource-label">С даты</label>
          <input
            type="date"
            value={filter.dateFrom ?? ''}
            onChange={(e) => patchFilter({ dateFrom: e.target.value || undefined })}
            className="resource-input text-sm"
          />
        </div>

        <div>
          <label className="resource-label">По дату</label>
          <input
            type="date"
            value={filter.dateTo ?? ''}
            onChange={(e) => patchFilter({ dateTo: e.target.value || undefined })}
            className="resource-input text-sm"
          />
        </div>

        <div>
          <label className="resource-label">Участок</label>
          <select
            value={filter.siteId ?? ''}
            onChange={(e) =>
              patchFilter({ siteId: e.target.value ? Number(e.target.value) : undefined })
            }
            className="resource-input text-sm"
          >
            <option value="">Все доступные</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="resource-label">Статус</label>
          <select
            value={filter.status ?? 'all'}
            onChange={(e) => patchFilter({ status: e.target.value as PartIssueStatus })}
            className="resource-input text-sm"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="resource-label">Гос. номер</label>
          <Combobox
            options={LICENSE_PLATES}
            value={filter.licensePlate ?? ''}
            onChange={(v) => patchFilter({ licensePlate: v || undefined })}
            placeholder="Любой"
          />
        </div>

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
          <button
            type="button"
            onClick={() => setFilter(DEFAULT_FILTER)}
            className="h-10 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold uppercase tracking-widest text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-900"
          >
            Сбросить
          </button>
          <a
            href={api.partIssuesExportUrl(filter)}
            className="flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-4 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-black"
          >
            <Download className="w-4 h-4" />
            Excel
          </a>
        </div>
      </div>

      {/* Массовое действие по выбранным строкам */}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-900 px-4 py-3 text-white">
          <span className="text-xs font-bold uppercase tracking-widest">
            Выбрано записей: {selected.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected([])}
              className="h-9 rounded-lg px-3 text-xs font-bold uppercase tracking-widest text-gray-300 transition-colors hover:text-white"
            >
              Снять выделение
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmExport(true);
                setActionError(null);
              }}
              className="flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-xs font-bold uppercase tracking-widest text-gray-900 transition-colors hover:bg-gray-100"
            >
              <Upload className="w-4 h-4" />
              Списать в 1С
            </button>
          </div>
        </div>
      )}

      {/* Итог по отфильтрованному */}
      {issues !== null && !listError && (
        <p className="text-[11px] uppercase tracking-wide text-gray-400">
          Записей: {issues.length} · всего штук: {total}
          {filter.status !== 'voided' &&
            issues.some((i) => i.voided) &&
            ' · отменённые показаны зачёркнутыми'}
        </p>
      )}

      {/* Таблица */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {issues === null && !listError && (
          <div className="flex items-center gap-2 px-4 py-6 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Загрузка…
          </div>
        )}
        {listError && (
          <p className="px-4 py-6 text-xs text-red-500">Не удалось загрузить журнал.</p>
        )}
        {issues !== null && issues.length === 0 && !listError && (
          <p className="px-4 py-6 text-xs text-gray-400">
            Записей нет — попробуйте изменить фильтр.
          </p>
        )}

        {issues !== null && issues.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[10px] uppercase tracking-wide text-gray-400">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={selectable.length === 0}
                      aria-label="Выбрать все"
                      className="h-4 w-4 cursor-pointer accent-gray-900 disabled:cursor-not-allowed"
                    />
                  </th>
                  <th className="px-4 py-2 text-left font-bold">Дата</th>
                  <th className="px-4 py-2 text-left font-bold">Участок</th>
                  <th className="px-4 py-2 text-left font-bold">Деталь</th>
                  <th className="px-4 py-2 text-right font-bold">Кол-во</th>
                  <th className="px-4 py-2 text-left font-bold">Гос. номер</th>
                  <th className="px-4 py-2 text-left font-bold">Получил</th>
                  <th className="px-4 py-2 text-left font-bold">Внёс</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {issues.map((i) => (
                  <tr
                    key={i.id}
                    className={`${i.voided ? 'opacity-50' : ''} ${
                      selected.includes(i.id) ? 'bg-gray-50' : ''
                    }`}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(i.id)}
                        onChange={() => toggleRow(i.id)}
                        disabled={i.voided || i.exported}
                        aria-label={`Выбрать ${i.name}`}
                        className="h-4 w-4 cursor-pointer accent-gray-900 disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {formatRu(i.issueDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {i.siteName}
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className={`font-bold text-gray-900 ${i.voided ? 'line-through' : ''}`}
                      >
                        {i.name}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        № {i.partNumber}
                      </div>
                      {i.comment && (
                        <div className="mt-0.5 text-[11px] text-gray-500">
                          Комментарий: {i.comment}
                        </div>
                      )}
                      {i.correction?.action === 'edit' && (
                        <div className="mt-1 text-[11px] text-amber-600">
                          правка от {authorName(i.correction.author)}: было{' '}
                          {i.correction.original.name} № {i.correction.original.partNumber},{' '}
                          {i.correction.original.qty} шт, {i.correction.original.recipient}
                        </div>
                      )}
                      {i.voided && (
                        <div className="mt-1 text-[11px] text-red-500">
                          отменил {authorName(i.correction!.author)}
                        </div>
                      )}
                      {i.exported && i.export1c && (
                        <div className="mt-1 text-[11px] text-emerald-600">
                          списан в 1С {formatRu(i.export1c.date)} ·{' '}
                          {authorName(i.export1c.author)}
                        </div>
                      )}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-bold ${
                        i.voided ? 'line-through text-gray-400' : 'text-gray-900'
                      }`}
                    >
                      {i.qty}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {i.licensePlate}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{i.recipient}</td>
                    <td className="px-4 py-3 text-[11px] text-gray-400">
                      {authorName(i.author)}
                    </td>
                    <td className="px-2 py-3">
                      {/* Списанная в 1С строка правке не подлежит — только возврат. */}
                      {!i.voided && i.exported && (
                        <DotsMenu
                          items={[
                            {
                              key: 'unmark',
                              label: 'Вернуть в актуальные',
                              icon: <RotateCcw className="w-4 h-4" />,
                              onSelect: () => {
                                setUnmarking(i);
                                setActionError(null);
                              },
                            },
                          ]}
                        />
                      )}
                      {!i.voided && !i.exported && (
                        <DotsMenu
                          items={[
                            {
                              key: 'edit',
                              label: 'Править',
                              icon: <Pencil className="w-4 h-4" />,
                              onSelect: () => {
                                setEditing(i);
                                setDraft(draftFrom(i));
                                setActionError(null);
                              },
                            },
                            {
                              key: 'void',
                              label: 'Отменить',
                              icon: <Ban className="w-4 h-4" />,
                              danger: true,
                              onSelect: () => {
                                setVoiding(i);
                                setActionError(null);
                              },
                            },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Правка записи */}
      {editing && draft && (
        <Modal
          open
          onClose={() => {
            setEditing(null);
            setDraft(null);
          }}
          title={`Правка: ${editing.name}`}
          wide
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="resource-label">Дата</label>
                <input
                  type="date"
                  value={draft.issueDate}
                  onChange={(e) => setDraft({ ...draft, issueDate: e.target.value })}
                  className="resource-input text-sm"
                />
              </div>
              <div>
                <label className="resource-label">Номер детали</label>
                <input
                  type="text"
                  value={draft.partNumber}
                  onChange={(e) => setDraft({ ...draft, partNumber: e.target.value })}
                  className="resource-input text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="resource-label">Наименование</label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="resource-input text-sm"
                />
              </div>
              <div>
                <label className="resource-label">Кол-во</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={draft.qty}
                  onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
                  className="resource-input text-sm"
                />
              </div>
              <div>
                <label className="resource-label">Гос. номер</label>
                <Combobox
                  options={LICENSE_PLATES}
                  value={draft.licensePlate}
                  onChange={(v) => setDraft({ ...draft, licensePlate: v })}
                  placeholder="Номер..."
                />
              </div>
              <div className="sm:col-span-2">
                <label className="resource-label">Получил</label>
                <input
                  type="text"
                  value={draft.recipient}
                  onChange={(e) => setDraft({ ...draft, recipient: e.target.value })}
                  className="resource-input text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="resource-label">
                  Комментарий <span className="text-gray-300">— не обязательно</span>
                </label>
                <input
                  type="text"
                  value={draft.comment}
                  onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
                  className="resource-input text-sm"
                />
              </div>
            </div>

            {actionError && <p className="text-xs text-red-500">{actionError}</p>}

            <p className="text-[11px] text-gray-400">
              Исходные значения сохранятся в истории — правка не затирает запись.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setDraft(null);
                }}
                className="h-10 rounded-lg border border-gray-200 px-4 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void onSaveEdit()}
                disabled={busy}
                className="flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-5 text-xs font-bold uppercase tracking-widest text-white hover:bg-black disabled:opacity-50"
              >
                Сохранить
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Подтверждение отмены записи */}
      {voiding && (
        <Modal open onClose={() => setVoiding(null)} title="Отмена записи">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {voiding.name} № {voiding.partNumber}, {voiding.qty} шт —{' '}
              {voiding.licensePlate}, {voiding.recipient}.
            </p>
            <p className="text-[11px] text-gray-400">
              Запись останется в журнале зачёркнутой и перестанет учитываться в итогах.
              Вернуть её обратно нельзя.
            </p>

            {actionError && <p className="text-xs text-red-500">{actionError}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoiding(null)}
                className="h-10 rounded-lg border border-gray-200 px-4 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900"
              >
                Оставить
              </button>
              <button
                type="button"
                onClick={() => void onVoid()}
                disabled={busy}
                className="flex h-10 items-center gap-2 rounded-lg bg-red-600 px-5 text-xs font-bold uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-50"
              >
                Отменить запись
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Подтверждение массового списания в 1С */}
      {confirmExport && (
        <Modal open onClose={() => setConfirmExport(false)} title="Списать в 1С">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Отметить списанными в 1С: {selectedIssues.length} зап. на{' '}
              {selectedIssues.reduce((sum, i) => sum + i.qty, 0)} шт.
            </p>
            <p className="text-[11px] text-gray-400">
              Записи уйдут в архив и пропадут из фильтра «Актуален». Править и
              отменять их будет нельзя — сначала придётся вернуть в актуальные,
              по одной из меню строки.
            </p>

            {actionError && <p className="text-xs text-red-500">{actionError}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmExport(false)}
                className="h-10 rounded-lg border border-gray-200 px-4 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void onExport()}
                disabled={busy}
                className="flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-5 text-xs font-bold uppercase tracking-widest text-white hover:bg-black disabled:opacity-50"
              >
                Списать
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Возврат одной записи из архива */}
      {unmarking && (
        <Modal
          open
          onClose={() => setUnmarking(null)}
          title="Вернуть в актуальные"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {unmarking.name} № {unmarking.partNumber}, {unmarking.qty} шт —{' '}
              {unmarking.licensePlate}, {unmarking.recipient}.
            </p>
            <p className="text-[11px] text-gray-400">
              Запись снова появится в фильтре «Актуален», правка и отмена станут
              доступны. Данные, уже занесённые в 1С, приложение не меняет.
            </p>

            {actionError && <p className="text-xs text-red-500">{actionError}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnmarking(null)}
                className="h-10 rounded-lg border border-gray-200 px-4 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void onUnmark()}
                disabled={busy}
                className="flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-5 text-xs font-bold uppercase tracking-widest text-white hover:bg-black disabled:opacity-50"
              >
                Вернуть
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PartIssuesTable;
