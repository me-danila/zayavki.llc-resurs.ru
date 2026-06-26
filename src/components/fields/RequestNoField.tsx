import React from 'react';
import { useFormContext } from 'react-hook-form';
import type { FormData } from '../../types';

export const RequestNoField: React.FC = () => {
  const { register, formState: { errors } } = useFormContext<FormData>();

  return (
    <div>
      <label className="text-[11px] uppercase font-bold text-gray-500 mb-1.5 block">Номер заявки</label>
      <input type="text" {...register('requestNo')} className="resource-input text-sm" placeholder="Например, Б125" />
      {errors.requestNo && <p className="mt-1 text-xs text-red-500">{errors.requestNo.message}</p>}
    </div>
  );
};
