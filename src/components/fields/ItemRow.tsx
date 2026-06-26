import React from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { Trash2 } from 'lucide-react';
import type { FormData } from '../../types';
import { ITEMS } from '../../data/itemsData';
import { LICENSE_PLATES } from '../../data/licenceNumberData';
import { Combobox } from '../ui/Combobox';
import { parseOptionalPrice } from '../../lib/parsePrice';

interface ItemRowProps {
  index: number;
  canRemove: boolean;
  onRemove: () => void;
}

export const ItemRow: React.FC<ItemRowProps> = ({ index, canRemove, onRemove }) => {
  const { control, register, formState: { errors } } = useFormContext<FormData>();
  const itemErrors = errors.items?.[index];

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 relative group transition-all">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
        {/* Наименование */}
        <div className="sm:col-span-4">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Наименование</label>
          <Controller
            name={`items.${index}.name`}
            control={control}
            render={({ field }) => (
              <Combobox
                options={ITEMS}
                value={field.value}
                onChange={field.onChange}
                placeholder="Выбор наименования..."
              />
            )}
          />
          {itemErrors?.name && <p className="mt-1 text-[10px] text-red-500">{itemErrors.name.message}</p>}
        </div>

        {/* Цель */}
        <div className="sm:col-span-3">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Цель покупки</label>
          <input type="text" {...register(`items.${index}.purpose`)} className="resource-input text-sm" placeholder="Для чего..." />
          {itemErrors?.purpose && <p className="mt-1 text-[10px] text-red-500">{itemErrors.purpose.message}</p>}
        </div>

        {/* Гос. номер */}
        <div className="sm:col-span-2">
          <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Гос. номер</label>
          <Controller
            name={`items.${index}.licensePlate`}
            control={control}
            render={({ field }) => (
              <Combobox
                options={LICENSE_PLATES}
                value={field.value}
                onChange={field.onChange}
                placeholder="Номер..."
              />
            )}
          />
          {itemErrors?.licensePlate && <p className="mt-1 text-[10px] text-red-500">{itemErrors.licensePlate.message}</p>}
        </div>

        {/* Кол-во и Цена */}
        <div className="sm:col-span-3 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Кол-во</label>
            <input type="text" {...register(`items.${index}.quantity`)} className="resource-input text-sm" />
          </div>
          <div className="relative">
            <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Цена</label>
            <input
              type="text"
              inputMode="decimal"
              {...register(`items.${index}.price`, { setValueAs: parseOptionalPrice })}
              className="resource-input text-sm"
            />
            {itemErrors?.price && <p className="mt-1 text-[10px] text-red-500">{itemErrors.price.message}</p>}
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
