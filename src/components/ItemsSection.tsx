import React from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { Plus, ClipboardList } from 'lucide-react';
import type { FormData } from '../types';
import { EMPTY_ITEM } from '../constants';
import { ItemRow } from './fields/ItemRow';

export const ItemsSection: React.FC = () => {
  const { control, formState: { errors } } = useFormContext<FormData>();
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-gray-400" />
          <h2 className="text-sm font-bold uppercase text-gray-700 tracking-wide">Позиции в заявке</h2>
        </div>
      </div>

      {fields.map((field, index) => (
        <ItemRow
          key={field.id}
          index={index}
          canRemove={fields.length > 1}
          onRemove={() => remove(index)}
        />
      ))}
      {errors.items?.root && <p className="text-red-500 text-xs font-bold uppercase">{errors.items.root.message}</p>}

      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={() => append(EMPTY_ITEM)}
          className="bg-white border-2 border-dashed border-gray-200 hover:border-resource-primary hover:text-resource-primary text-gray-400 w-full py-4 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <Plus className="w-5 h-5" />
          Добавить позицию
        </button>
      </div>
    </div>
  );
};
