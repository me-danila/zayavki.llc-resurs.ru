// Хронология одной партии — раскрывающаяся секция (просмотр; действия — в модалках).
// Тянет getHistory(lotId): строка прихода (+qty, автор) и строки списаний
// (№ авто, −qty, остаток-после, причина, автор). Время не выводим (канон §3.2).
// Корректировки: void — строка приглушена, qty зачёркнут, бейдж «Отменено» (voided
// НЕ уменьшает balanceAfter — «остаток» у такой строки прячем); edit — бейдж
// «Исправлено» + мелкая строка «было: …». scope='manager' даёт `…`-меню у КАЖДОГО
// правимого события без корректировки: у прихода (kind='receipt', id = lot.id) —
// модалки correctReceipt (правка/отмена), у списания — модалки correctWriteoff.
// transfer_in/transfer_out не правятся. № авто в правке списания — тот же Combobox
// LICENSE_PLATES, что у механика (WriteOffRow). scope='worker' (дефолт) — read-only.
// После успеха — внутренний refetch + onChanged() (родитель обновит остатки).

import React from 'react';
import {
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowRightLeft,
  Pencil,
  XCircle,
} from 'lucide-react';
import {
  getHistory,
  correctWriteoff,
  correctReceipt,
  ApiError,
} from '../../lib/gsmApi';
import type { ReceiptCorrectPayload } from '../../lib/gsmApi';
import type { HistoryEvent, Lot } from '../../lib/gsmTypes';
import { EPS } from '../../lib/gsmSchemas';
import { todayMsk } from '../../lib/gsmDates';
import { parseQuantity } from '../../lib/parseQuantity';
import { LICENSE_PLATES } from '../../data/licenceNumberData';
import { Combobox } from '../ui/Combobox';
import DotsMenu from './DotsMenu';
import Modal from './Modal';

export interface LotHistoryProps {
  lotId: number;
  unit?: string;
  // 'worker' (дефолт) — read-only; 'manager' — правка/отмена прихода и списаний.
  scope?: 'manager' | 'worker';
  // Дёргается после успешной корректировки (родитель перезагрузит lots).
  onChanged?: () => void;
}

const authorName = (a: HistoryEvent['author']): string =>
  a.displayName || a.username;

// Кол-во без хвостовых нулей: 12.500 → 12.5, 10.000 → 10.
const fmtQty = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return String(r);
};

// Единые классы кнопок модалок (одинаковый размер primary/secondary/danger).
const BTN_PRIMARY =
  'rounded-lg bg-gray-900 px-5 py-2 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-black disabled:opacity-50';
const BTN_DANGER =
  'rounded-lg bg-red-500 px-5 py-2 text-xs font-bold uppercase tracking-wide text-white transition-all hover:bg-red-600 disabled:opacity-50';
const MODAL_FOOTER =
  'flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end';
const FIELD_LABEL =
  'mb-1 block text-[11px] font-bold uppercase text-gray-400';

// Код ошибки бека из ApiError (тело {error:'...'} попадает в .message).
const apiErrorCode = (err: unknown): string | null =>
  err instanceof ApiError ? err.message : null;

// Человекочитаемый текст ошибки корректировки списания.
const writeoffErrorText = (err: unknown, unit: string): string => {
  if (err instanceof ApiError) {
    const code = apiErrorCode(err);
    if (code === 'exceeds') {
      const body = err.body as { balance?: number } | null;
      return body?.balance !== undefined
        ? `Больше остатка (${fmtQty(body.balance)} ${unit})`
        : 'Больше остатка партии.';
    }
    if (code === 'transfer_locked')
      return 'Списание участвует в перемещении — правка недоступна.';
    if (code === 'already_voided') return 'Списание уже отменено.';
    if (err.status === 400) return 'Проверьте поля.';
    if (err.status === 404) return 'Списание не найдено.';
  }
  return 'Не удалось сохранить. Попробуйте позже.';
};

// Человекочитаемый текст ошибки корректировки прихода.
const receiptErrorText = (err: unknown, unit: string): string => {
  if (err instanceof ApiError) {
    const code = apiErrorCode(err);
    if (code === 'has_writeoffs')
      return 'Нельзя: по партии есть списания. Сначала отмените их в истории.';
    if (code === 'transfer_locked')
      return 'Партия участвует в перемещении — отмена недоступна.';
    if (code === 'already_voided') return 'Приход уже отменён.';
    if (code === 'exceeds') {
      const body = err.body as { balance?: number } | null;
      return body?.balance !== undefined
        ? `Нельзя меньше уже списанного: остаток ${fmtQty(body.balance)} ${unit}`
        : 'Нельзя меньше уже списанного.';
    }
    if (err.status === 400) return 'Проверьте поля.';
    if (err.status === 404) return 'Партия недоступна.';
  }
  return 'Не удалось сохранить. Попробуйте позже.';
};

// --- Содержимое confirm-модалки отмены списания ---

interface WriteoffVoidConfirmProps {
  ev: HistoryEvent;
  unit: string;
  onDone: () => void;
  onCancel: () => void;
}

const WriteoffVoidConfirm: React.FC<WriteoffVoidConfirmProps> = ({
  ev,
  unit,
  onDone,
  onCancel,
}) => {
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const doVoid = async () => {
    if (ev.writeoffId === undefined) return;
    setError(null);
    setSubmitting(true);
    try {
      await correctWriteoff(ev.writeoffId, { action: 'void' });
      onDone();
    } catch (err) {
      setError(writeoffErrorText(err, unit));
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        Отменить списание от {ev.date} на {fmtQty(ev.qty)} {unit}? Количество
        вернётся в остаток партии.
      </p>
      {error && <p className="text-xs font-bold text-red-500">{error}</p>}
      <div className={MODAL_FOOTER}>
        <button
          type="button"
          onClick={onCancel}
          className="resource-button-secondary"
        >
          Оставить
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void doVoid()}
          className={BTN_DANGER}
        >
          Отменить списание
        </button>
      </div>
    </div>
  );
};

// --- Содержимое модалки правки списания (Дата, Кол-во, № авто, Причина) ---

interface WriteoffEditFormProps {
  ev: HistoryEvent;
  unit: string;
  // Дата прихода партии — нижняя граница даты списания.
  minDate?: string;
  onDone: () => void;
  onCancel: () => void;
}

const WriteoffEditForm: React.FC<WriteoffEditFormProps> = ({
  ev,
  unit,
  minDate,
  onDone,
  onCancel,
}) => {
  const [date, setDate] = React.useState(ev.date);
  const [qtyRaw, setQtyRaw] = React.useState(fmtQty(ev.qty));
  const [plate, setPlate] = React.useState(ev.licensePlate ?? '');
  const [reason, setReason] = React.useState(ev.reason ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ev.writeoffId === undefined) return;
    setError(null);

    const amount = parseQuantity(qtyRaw);
    if (!Number.isFinite(amount) || amount <= EPS) {
      setError('Укажите количество больше 0.');
      return;
    }
    if (!date || date > todayMsk() || (minDate !== undefined && date < minDate)) {
      setError('Проверьте дату (не раньше прихода и не в будущем).');
      return;
    }
    if (!plate.trim() || !reason.trim()) {
      setError('Укажите № авто и причину.');
      return;
    }

    setSubmitting(true);
    try {
      await correctWriteoff(ev.writeoffId, {
        action: 'edit',
        date,
        amount,
        licensePlate: plate.trim(),
        reason: reason.trim(),
      });
      onDone();
    } catch (err) {
      setError(writeoffErrorText(err, unit));
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
        <div className="sm:col-span-3">
          <label className={FIELD_LABEL}>Дата</label>
          <input
            type="date"
            min={minDate}
            max={todayMsk()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="resource-input text-sm"
          />
        </div>
        <div className="sm:col-span-3">
          <label className={FIELD_LABEL}>Кол-во, {unit}</label>
          <input
            type="text"
            inputMode="decimal"
            value={qtyRaw}
            onChange={(e) => setQtyRaw(e.target.value)}
            className="resource-input text-sm"
            placeholder="0"
          />
        </div>
        <div className="sm:col-span-3">
          <label className={FIELD_LABEL}>№ авто</label>
          <Combobox
            options={LICENSE_PLATES}
            value={plate}
            onChange={setPlate}
            placeholder="Номер..."
            allowCustom
          />
        </div>
        <div className="sm:col-span-3">
          <label className={FIELD_LABEL}>Причина</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="resource-input text-sm"
          />
        </div>
      </div>

      {error && <p className="text-xs font-bold text-red-500">{error}</p>}

      <div className={MODAL_FOOTER}>
        <button
          type="button"
          onClick={onCancel}
          className="resource-button-secondary"
        >
          Отмена
        </button>
        <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
          Сохранить
        </button>
      </div>
    </form>
  );
};

// --- Содержимое confirm-модалки отмены прихода ---

interface VoidReceiptConfirmProps {
  lot: Lot;
  onDone: () => void;
  onCancel: () => void;
}

const VoidReceiptConfirm: React.FC<VoidReceiptConfirmProps> = ({
  lot,
  onDone,
  onCancel,
}) => {
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const doVoid = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await correctReceipt(lot.id, { action: 'void' });
      onDone();
    } catch (err) {
      setError(receiptErrorText(err, lot.unit));
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        Отменить приход «{lot.name}» от {lot.receivedDate}? Партия исчезнет из
        остатков.
      </p>
      {error && <p className="text-xs font-bold text-red-500">{error}</p>}
      <div className={MODAL_FOOTER}>
        <button
          type="button"
          onClick={onCancel}
          className="resource-button-secondary"
        >
          Оставить
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void doVoid()}
          className={BTN_DANGER}
        >
          Отменить приход
        </button>
      </div>
    </div>
  );
};

// --- Содержимое модалки правки прихода (Наименование, Код, Дата, Количество, Ед.) ---

interface ReceiptEditFormProps {
  lot: Lot;
  onDone: () => void;
  onCancel: () => void;
}

const ReceiptEditForm: React.FC<ReceiptEditFormProps> = ({
  lot,
  onDone,
  onCancel,
}) => {
  const [date, setDate] = React.useState(lot.receivedDate);
  const [name, setName] = React.useState(lot.name);
  const [code, setCode] = React.useState(lot.code);
  const [unit, setUnit] = React.useState(lot.unit);
  const [qtyRaw, setQtyRaw] = React.useState(fmtQty(lot.initialQty));
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const quantity = parseQuantity(qtyRaw);
    if (!Number.isFinite(quantity) || quantity <= EPS) {
      setError('Укажите количество больше 0.');
      return;
    }
    if (!date || date > todayMsk()) {
      setError('Дата не может быть в будущем.');
      return;
    }
    if (!name.trim() || !code.trim() || !unit.trim()) {
      setError('Заполните наименование, код и ед. изм.');
      return;
    }

    // Шлём только изменённые поля (бек снапшотит остальное сам).
    const body: ReceiptCorrectPayload & { action: 'edit' } = { action: 'edit' };
    if (date !== lot.receivedDate) body.receivedDate = date;
    if (name.trim() !== lot.name) body.name = name.trim();
    if (code.trim() !== lot.code) body.code = code.trim();
    if (unit.trim() !== lot.unit) body.unit = unit.trim();
    if (Math.abs(quantity - lot.initialQty) > EPS) body.quantity = quantity;
    if (Object.keys(body).length === 1) {
      // ничего не поменялось — просто закрываем модалку
      onCancel();
      return;
    }

    setSubmitting(true);
    try {
      await correctReceipt(lot.id, body);
      onDone();
    } catch (err) {
      setError(receiptErrorText(err, unit.trim() || lot.unit));
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
        <div className="sm:col-span-4">
          <label className={FIELD_LABEL}>Наименование</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="resource-input text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={FIELD_LABEL}>Код</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="resource-input text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={FIELD_LABEL}>Дата</label>
          <input
            type="date"
            max={todayMsk()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="resource-input text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={FIELD_LABEL}>Количество</label>
          <input
            type="text"
            inputMode="decimal"
            value={qtyRaw}
            onChange={(e) => setQtyRaw(e.target.value)}
            className="resource-input text-sm"
            placeholder="0"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={FIELD_LABEL}>Ед.</label>
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="resource-input text-sm"
          />
        </div>
      </div>

      {error && <p className="text-xs font-bold text-red-500">{error}</p>}

      <div className={MODAL_FOOTER}>
        <button
          type="button"
          onClick={onCancel}
          className="resource-button-secondary"
        >
          Отмена
        </button>
        <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
          Сохранить
        </button>
      </div>
    </form>
  );
};

// --- Корневой компонент ---

const LotHistory: React.FC<LotHistoryProps> = ({
  lotId,
  unit = 'л',
  scope = 'worker',
  onChanged,
}) => {
  // setState — только в .then/.catch (не синхронно в эффекте, react-hooks/set-state-in-effect).
  // loading выводим из данных; при refetch старый список остаётся видимым до ответа.
  const [data, setData] = React.useState<{
    events: HistoryEvent[];
    lot: Lot;
  } | null>(null);
  const [error, setError] = React.useState(false);
  // Открытая модалка правки/отмена события (приход или списание — по ev.kind).
  const [modal, setModal] = React.useState<{
    ev: HistoryEvent;
    mode: 'void' | 'edit';
  } | null>(null);
  // Инкремент → refetch (после корректировки).
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    getHistory(lotId)
      .then((res) => {
        if (!alive) return;
        setData({ events: res.events, lot: res.lot });
        setError(false);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
      });
    return () => {
      alive = false;
    };
  }, [lotId, reloadKey]);

  const events = data?.events ?? null;
  const lot = data?.lot ?? null;
  const loading = data === null && !error;

  // Успешная корректировка: закрыть модалку, перечитать историю, оповестить родителя.
  const handleCorrected = React.useCallback(() => {
    setModal(null);
    setReloadKey((k) => k + 1);
    onChanged?.();
  }, [onChanged]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Загрузка истории…
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-4 text-xs text-red-500">Не удалось загрузить историю.</p>
    );
  }

  if (!events || events.length === 0) {
    return <p className="py-4 text-xs text-gray-400">Событий нет.</p>;
  }

  const isReceiptModal = modal?.ev.kind === 'receipt';

  return (
    <>
      {/* История слитно со строкой/карточкой — без верхнего дивайдера (обе роли). */}
      <ul className="mt-1 space-y-2">
        {events.map((ev, i) => {
          const isIncoming = ev.kind === 'receipt' || ev.kind === 'transfer_in';
          const isTransfer =
            ev.kind === 'transfer_in' || ev.kind === 'transfer_out';
          const corr = ev.correction;
          const voided = corr?.action === 'void';
          const edited = corr?.action === 'edit';
          // Правится «живое» событие без корректировки: списание (correctWriteoff)
          // или приход партии (correctReceipt, id = lot.id). Перемещения — нет.
          const canCorrect =
            scope === 'manager' &&
            !corr &&
            ((ev.kind === 'writeoff' && ev.writeoffId !== undefined) ||
              (ev.kind === 'receipt' && lot !== null));
          // Подпись события (нижняя строка с автором).
          const label =
            ev.kind === 'receipt'
              ? 'Приход'
              : ev.kind === 'writeoff'
                ? 'Списание'
                : ev.kind === 'transfer_in'
                  ? `Поступление ← ${ev.counterSiteName ?? '—'}`
                  : `Перемещение → ${ev.counterSiteName ?? '—'}`;
          // «было: …» под исправленной строкой.
          const originalParts =
            edited && corr
              ? [
                  `${fmtQty(corr.original.qty)} ${corr.original.unit ?? unit}`,
                  corr.original.date,
                  corr.original.name &&
                    `${corr.original.name}${corr.original.code ? ` (${corr.original.code})` : ''}`,
                  corr.original.licensePlate,
                  corr.original.reason,
                ].filter(Boolean)
              : [];

          return (
            <li
              key={i}
              className={`rounded-lg bg-gray-50 px-3 py-2 ${voided ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    isIncoming
                      ? 'bg-resource-primary/20 text-gray-700'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {isTransfer ? (
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  ) : isIncoming ? (
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowUpFromLine className="h-3.5 w-3.5" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-xs font-bold text-gray-700">
                      {ev.date}
                    </span>
                    <span
                      className={`text-xs font-bold ${
                        voided
                          ? 'text-gray-400 line-through'
                          : isIncoming
                            ? 'text-green-600'
                            : 'text-red-500'
                      }`}
                    >
                      {isIncoming ? '+' : '−'}
                      {fmtQty(ev.qty)} {unit}
                    </span>
                    {/* Voided не влияет на balanceAfter — «остаток» у него прячем. */}
                    {!isIncoming && !voided && (
                      <span className="text-[11px] text-gray-500">
                        остаток: {fmtQty(ev.balanceAfter)} {unit}
                      </span>
                    )}
                    {voided && corr && (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                        Отменено · {authorName(corr.author)} · {corr.date}
                      </span>
                    )}
                    {edited && corr && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                        Исправлено · {authorName(corr.author)} · {corr.date}
                      </span>
                    )}
                  </div>

                  {ev.kind === 'writeoff' && (
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                      {ev.licensePlate && (
                        <span>
                          № авто:{' '}
                          <span className="text-gray-700">
                            {ev.licensePlate}
                          </span>
                        </span>
                      )}
                      {ev.reason && (
                        <span>
                          причина:{' '}
                          <span className="text-gray-700">{ev.reason}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {originalParts.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      было: {originalParts.join(', ')}
                    </p>
                  )}

                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {label} — {authorName(ev.author)}
                  </p>
                </div>

                {canCorrect && (
                  <DotsMenu
                    items={[
                      {
                        key: 'edit',
                        label: 'Редактировать',
                        icon: <Pencil className="h-4 w-4" />,
                        onSelect: () => setModal({ ev, mode: 'edit' }),
                      },
                      {
                        key: 'void',
                        label: 'Отменить',
                        icon: <XCircle className="h-4 w-4" />,
                        danger: true,
                        onSelect: () => setModal({ ev, mode: 'void' }),
                      },
                    ]}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Модалки правки/отмена списания */}
      {modal?.mode === 'void' && !isReceiptModal && (
        <Modal open onClose={() => setModal(null)} title="Отмена списания">
          <WriteoffVoidConfirm
            ev={modal.ev}
            unit={unit}
            onDone={handleCorrected}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.mode === 'edit' && !isReceiptModal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={`Редактирование списания от ${modal.ev.date}`}
        >
          <WriteoffEditForm
            ev={modal.ev}
            unit={unit}
            minDate={lot?.receivedDate}
            onDone={handleCorrected}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {/* Модалки правки/отмена прихода (id прихода = id партии) */}
      {modal?.mode === 'void' && isReceiptModal && lot && (
        <Modal open onClose={() => setModal(null)} title="Отмена прихода">
          <VoidReceiptConfirm
            lot={lot}
            onDone={handleCorrected}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.mode === 'edit' && isReceiptModal && lot && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={`Редактирование прихода: ${lot.name}`}
        >
          <ReceiptEditForm
            lot={lot}
            onDone={handleCorrected}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </>
  );
};

export default LotHistory;
