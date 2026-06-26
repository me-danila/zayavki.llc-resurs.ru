import React from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import type { FormData } from '../../types';
import { LOTS } from '../../data/lotData';
import { Combobox } from '../ui/Combobox';

export const SiteField: React.FC = () => {
  const { control, formState: { errors } } = useFormContext<FormData>();

  return (
    <div>
      <label className="text-[11px] uppercase font-bold text-gray-500 mb-1.5 block">Участок</label>
      <Controller
        name="site"
        control={control}
        render={({ field }) => (
          <Combobox
            options={LOTS}
            value={field.value}
            onChange={field.onChange}
            placeholder="Выберите участок..."
          />
        )}
      />
      {errors.site && <p className="mt-1 text-xs text-red-500">{errors.site.message}</p>}
    </div>
  );
};
