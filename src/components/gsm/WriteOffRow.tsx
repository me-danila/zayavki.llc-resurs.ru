// Строка серии списания (этап 6). Шаблон — ItemRow + useFieldArray (поле 'rows').
// Поля: дата (type=date, min=приход, max=сегодня); № авто (Combobox LICENSE_PLATES,
// allowCustom); выдано (decimal, setValueAs=parseQuantity); остаток (readonly бегущий);
// причина (обязательна). Ошибка превышения остатка приходит на rows.i.amount — под «выдано».
//
// running[index] — бегущий остаток ПОСЛЕ этой строки, считает родитель (WriteOffForm).
// Форматируем без хвостовых нулей; красный, если ушли в минус.

import React from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { Trash2 } from 'lucide-react';
import { LICENSE_PLATES } from '../../data/licenceNumberData';
import { Combobox } from '../ui/Combobox';
import { parseQuantity } from '../../lib/parseQuantity';
import { todayMsk } from '../../lib/gsmDates';
import type { Lot } from '../../lib/gsmTypes';
import type { WriteOffData } from '../../lib/gsmSchemas';

interface WriteOffRowProps {
  index: number;
  lot: Lot;
  running: number; // бегущий остаток после этой строки (NaN-безопасный, округлён родителем)
  canRemove: boolean;
  onRemove: () => void;
}

// Кол-во без хвостовых нулей: 12.500 → 12.5, 10.000 → 10.
const fmtQty = (n: number): string => {
  if (!Number.isFinite(n)) return '—';
  return String(Math.round(n * 1000) / 1000);
};

const WriteOffRow: React.FC<WriteOffRowProps> = ({
  index,
  lot,
  running,
  canRemove,
  onRemove,
}) => {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<WriteOffData>();

  const rowErrors = errors.rows?.[index];
  const negative = running < 0;

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 relative group transition-all">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
        {/* Дата */}
        <div className="sm:col-span-2">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
            Дата
          </label>
          <input
            type="date"
            min={lot.receivedDate}
            max={todayMsk()}
            {...register(`rows.${index}.date`)}
            className="resource-input text-sm"
          />
          {rowErrors?.date && (
            <p className="mt-1 text-[10px] text-red-500">{rowErrors.date.message}</p>
          )}
        </div>

        {/* № авто */}
        <div className="sm:col-span-2">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
            № авто
          </label>
          <Controller
            name={`rows.${index}.plate`}
            control={control}
            render={({ field }) => (
              <Combobox
                options={LICENSE_PLATES}
                value={field.value ?? ''}
                onChange={field.onChange}
                placeholder="Номер..."
                allowCustom
              />
            )}
          />
          {rowErrors?.plate && (
            <p className="mt-1 text-[10px] text-red-500">{rowErrors.plate.message}</p>
          )}
        </div>

        {/* Выдано */}
        <div className="sm:col-span-2">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
            Выдано
          </label>
          <input
            type="text"
            inputMode="decimal"
            {...register(`rows.${index}.amount`, { setValueAs: parseQuantity })}
            className="resource-input text-sm"
            placeholder="0"
          />
          {rowErrors?.amount && (
            <p className="mt-1 text-[10px] text-red-500">{rowErrors.amount.message}</p>
          )}
        </div>

        {/* Остаток (readonly бегущий) */}
        <div className="sm:col-span-2">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
            Остаток
          </label>
          <input
            type="text"
            readOnly
            tabIndex={-1}
            value={`${fmtQty(running)} ${lot.unit}`}
            className={`resource-input text-sm bg-gray-50 ${
              negative ? 'text-red-500 font-bold' : 'text-gray-500'
            }`}
          />
        </div>

        {/* Причина */}
        <div className="sm:col-span-4">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">
            Причина
          </label>
          <div className="relative">
            <input
              type="text"
              {...register(`rows.${index}.reason`)}
              className="resource-input text-sm"
              placeholder="Причина..."
            />
            {canRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="absolute -right-2 -top-7 p-1 text-gray-300 hover:text-red-500 transition-colors"
                title="Удалить строку"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          {rowErrors?.reason && (
            <p className="mt-1 text-[10px] text-red-500">{rowErrors.reason.message}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default WriteOffRow;
