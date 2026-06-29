// Форма перемещения одной партии на другой активный участок (этап 7, фронт шаг 2).
// Модель (зафиксировано на беке): атомарно списание с исходной партии + новая партия
// на целевом участке. Здесь — UI: целевой участок (Combobox по активным sites КРОМЕ
// текущего, allowCustom=false), количество (parseQuantity, ≤ lot.balance) с остатком-после,
// дата (type=date; min=lot.receivedDate, max=сегодня; дефолт сегодня).
// Сабмит → transferLot(lot.id,{toSiteId,qty,date}); 409 exceeds → «Больше остатка»;
// 400 → «Проверьте участок/дату»; success → onDone().

import React from 'react';
import { ArrowRightLeft, X } from 'lucide-react';
import { Combobox } from '../ui/Combobox';
import { parseQuantity } from '../../lib/parseQuantity';
import { todayMsk } from '../../lib/gsmDates';
import { transferLot, ApiError } from '../../lib/gsmApi';
import { EPS } from '../../lib/gsmSchemas';
import type { Lot, Site } from '../../lib/gsmTypes';

export interface TransferFormProps {
  lot: Lot;
  sites: Site[];
  onDone: () => void;
  onCancel: () => void;
}

// Кол-во без хвостовых нулей: 12.500 → 12.5.
const fmtQty = (n: number): string => {
  if (!Number.isFinite(n)) return '—';
  return String(Math.round(n * 1000) / 1000);
};

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const TransferForm: React.FC<TransferFormProps> = ({
  lot,
  sites,
  onDone,
  onCancel,
}) => {
  const [siteName, setSiteName] = React.useState('');
  const [qtyRaw, setQtyRaw] = React.useState('');
  const [date, setDate] = React.useState(() => todayMsk());
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Активные участки КРОМЕ исходного (по id и по имени — подстраховка).
  const targets = React.useMemo(
    () =>
      sites.filter(
        (s) => s.active && s.id !== lot.siteId && s.name !== lot.siteName
      ),
    [sites, lot.siteId, lot.siteName]
  );
  const targetNames = React.useMemo(() => targets.map((s) => s.name), [targets]);

  const qty = parseQuantity(qtyRaw);
  const qtyValid = Number.isFinite(qty) && qty > EPS;
  const after = qtyValid ? round3(lot.balance - qty) : lot.balance;
  const overBalance = qtyValid && qty - lot.balance > EPS;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const target = targets.find((s) => s.name === siteName);
    if (!target) {
      setFormError('Выберите целевой участок.');
      return;
    }
    if (!qtyValid) {
      setFormError('Укажите количество.');
      return;
    }
    if (overBalance) {
      setFormError(`Больше остатка (${fmtQty(lot.balance)} ${lot.unit})`);
      return;
    }
    if (date < lot.receivedDate || date > todayMsk()) {
      setFormError('Проверьте участок/дату.');
      return;
    }

    setSubmitting(true);
    try {
      await transferLot(lot.id, { toSiteId: target.id, qty, date });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { balance?: number } | null;
        setFormError(
          body?.balance !== undefined
            ? `Больше остатка (${fmtQty(body.balance)} ${lot.unit})`
            : 'Больше остатка'
        );
      } else if (err instanceof ApiError && err.status === 400) {
        setFormError('Проверьте участок/дату.');
      } else if (err instanceof ApiError && err.status === 404) {
        setFormError('Партия недоступна.');
      } else {
        setFormError('Не удалось переместить. Попробуйте позже.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-gray-200 bg-[#F9FAFB] p-4 sm:p-5 space-y-4"
    >
      {/* Шапка */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-gray-700">
          <ArrowRightLeft className="w-5 h-5 text-gray-400" />
          <h2 className="text-sm font-bold uppercase tracking-wide">
            Перемещение: {lot.name}{' '}
            <span className="text-gray-400">({lot.code})</span> — остаток{' '}
            {fmtQty(lot.balance)} {lot.unit}
          </h2>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 text-gray-300 hover:text-gray-600 transition-colors"
          title="Отмена"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-white p-5 rounded-lg border border-gray-200">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
          {/* Дата — первой ячейкой */}
          <div className="sm:col-span-2">
            <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
              Дата
            </label>
            <input
              type="date"
              min={lot.receivedDate}
              max={todayMsk()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="resource-input text-sm"
            />
          </div>

          {/* Целевой участок */}
          <div className="sm:col-span-5">
            <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
              Участок назначения
            </label>
            <Combobox
              options={targetNames}
              value={siteName}
              onChange={setSiteName}
              placeholder="Выберите участок..."
              emptyMessage="Нет доступных участков."
              allowCustom={false}
            />
          </div>

          {/* Количество */}
          <div className="sm:col-span-3">
            <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
              Количество
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={qtyRaw}
              onChange={(e) => setQtyRaw(e.target.value)}
              className="resource-input text-sm"
              placeholder="0"
            />
          </div>

          {/* Остаток после */}
          <div className="sm:col-span-2">
            <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
              Остаток после
            </label>
            <input
              type="text"
              readOnly
              tabIndex={-1}
              value={`${fmtQty(after)} ${lot.unit}`}
              className={`resource-input text-sm bg-gray-50 ${
                overBalance ? 'text-red-500 font-bold' : 'text-gray-500'
              }`}
            />
          </div>
        </div>
      </div>

      {formError && <p className="text-xs font-bold text-red-500">{formError}</p>}

      {/* Футер: отмена + переместить */}
      <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={onCancel}
          className="resource-button-secondary w-full sm:w-auto"
        >
          Отмена
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex w-full sm:w-auto sm:flex-1 items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-black disabled:opacity-50"
        >
          <ArrowRightLeft className="w-4 h-4" />
          Переместить
        </button>
      </div>
    </form>
  );
};

export default TransferForm;
