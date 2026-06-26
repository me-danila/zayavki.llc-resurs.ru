// Строка прихода (manager). Шаблон — ItemRow: grid + useFormContext + useFieldArray('rows').
// Поля §4/§6: дата получения (type=date, дефолт todayMsk, будущее запрещено),
// участок (Combobox LOTS, allowCustom=false, через Controller), наименование (свободный input),
// код (input), кол-во (input decimal, setValueAs=parseQuantity), ед.изм (input, дефолт 'л').
// Цены здесь НЕТ. Кнопка удаления — только когда строк >1.

import React from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { Trash2 } from 'lucide-react';
import type { ReceiptData } from '../../lib/gsmSchemas';
import { todayMsk } from '../../lib/gsmDates';
import { parseQuantity } from '../../lib/parseQuantity';
import { LOTS } from '../../data/lotData';
import { Combobox } from '../ui/Combobox';

interface ReceiptRowProps {
  index: number;
  canRemove: boolean;
  onRemove: () => void;
}

export const ReceiptRow: React.FC<ReceiptRowProps> = ({ index, canRemove, onRemove }) => {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<ReceiptData>();
  const rowErrors = errors.rows?.[index];
  const today = todayMsk();

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 relative group transition-all">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
        {/* Дата получения */}
        <div className="sm:col-span-2">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Дата</label>
          <input
            type="date"
            max={today}
            {...register(`rows.${index}.date`)}
            className="resource-input text-sm"
          />
          {rowErrors?.date && (
            <p className="mt-1 text-[10px] text-red-500">{rowErrors.date.message}</p>
          )}
        </div>

        {/* Участок */}
        <div className="sm:col-span-3">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Участок</label>
          <Controller
            name={`rows.${index}.siteName`}
            control={control}
            render={({ field }) => (
              <Combobox
                options={LOTS}
                value={field.value ?? ''}
                onChange={field.onChange}
                placeholder="Выбор участка..."
                allowCustom={false}
              />
            )}
          />
          {rowErrors?.siteName && (
            <p className="mt-1 text-[10px] text-red-500">{rowErrors.siteName.message}</p>
          )}
        </div>

        {/* Наименование */}
        <div className="sm:col-span-3">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Наименование</label>
          <input
            type="text"
            {...register(`rows.${index}.name`)}
            className="resource-input text-sm"
            placeholder="Напр. Масло М-10"
          />
          {rowErrors?.name && (
            <p className="mt-1 text-[10px] text-red-500">{rowErrors.name.message}</p>
          )}
        </div>

        {/* Код */}
        <div className="sm:col-span-2">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Код</label>
          <input
            type="text"
            {...register(`rows.${index}.code`)}
            className="resource-input text-sm"
            placeholder="Код"
          />
          {rowErrors?.code && (
            <p className="mt-1 text-[10px] text-red-500">{rowErrors.code.message}</p>
          )}
        </div>

        {/* Кол-во и Ед.изм */}
        <div className="sm:col-span-2 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Кол-во</label>
            <input
              type="text"
              inputMode="decimal"
              {...register(`rows.${index}.quantity`, { setValueAs: parseQuantity })}
              className="resource-input text-sm"
            />
            {rowErrors?.quantity && (
              <p className="mt-1 text-[10px] text-red-500">{rowErrors.quantity.message}</p>
            )}
          </div>
          <div className="relative">
            <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Ед. изм.</label>
            <input
              type="text"
              {...register(`rows.${index}.unit`)}
              className="resource-input text-sm"
            />
            {rowErrors?.unit && (
              <p className="mt-1 text-[10px] text-red-500">{rowErrors.unit.message}</p>
            )}
            {canRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="absolute -right-2 -top-1 p-1 text-gray-300 hover:text-red-500 transition-colors"
                title="Удалить"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
