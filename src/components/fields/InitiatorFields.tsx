import React from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import type { FormData } from '../../types';
import { INITIATORS } from '../../data/initiatorData';
import { getPublicInitiators } from '../../lib/gsmApi';
import { Combobox } from '../ui/Combobox';

export const InitiatorFields: React.FC = () => {
  const {
    control,
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<FormData>();

  // Справочник живёт в БД (ведётся в /gsm под правом initiators.manage).
  // Статический список остаётся фолбэком: форма заявки не должна ломаться,
  // если API недоступен.
  const [initiators, setInitiators] = React.useState(INITIATORS);

  React.useEffect(() => {
    let cancelled = false;
    getPublicInitiators()
      .then(list => {
        if (!cancelled && list.length) {
          setInitiators(list.map(i => ({ name: i.name, position: i.position })));
        }
      })
      .catch(() => {
        // молча — остаёмся на статическом списке
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const initiatorName = watch('initiatorName');
  const matchingInitiator = initiators.find(i => i.name === initiatorName);
  const isPositionReadonly = !!matchingInitiator;

  // Подставляем должность, когда инициатор выбран из списка
  React.useEffect(() => {
    if (matchingInitiator) {
      setValue('initiatorPosition', matchingInitiator.position);
    }
  }, [matchingInitiator, setValue]);

  return (
    <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-5">
      <div>
        <label className="text-[11px] uppercase font-bold text-gray-500 mb-1.5 block">Инициатор</label>
        <Controller
          name="initiatorName"
          control={control}
          render={({ field }) => (
            <Combobox
              options={initiators.map(i => i.name)}
              value={field.value}
              onChange={field.onChange}
              placeholder="Иванов И.И."
            />
          )}
        />
        {errors.initiatorName && <p className="mt-1 text-xs text-red-500">{errors.initiatorName.message}</p>}
      </div>
      <div>
        <label className="text-[11px] uppercase font-bold text-gray-500 mb-1.5 block">Должность</label>
        <input
          type="text"
          {...register('initiatorPosition')}
          className={`resource-input text-sm ${isPositionReadonly ? 'bg-gray-50 text-gray-500' : ''}`}
          placeholder="Напр. Прораб"
          readOnly={isPositionReadonly}
        />
        {errors.initiatorPosition && <p className="mt-1 text-xs text-red-500">{errors.initiatorPosition.message}</p>}
      </div>
    </div>
  );
};
