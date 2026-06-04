import React from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import type { SubmitErrorHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, Send, ClipboardList } from 'lucide-react';
import { FormSchema } from './types';
import type { FormData } from './types';
import { LOTS } from './data/lotData';
import { INITIATORS } from './data/initiatorData';
import { ITEMS } from './data/itemsData';
import { LICENSE_PLATES } from './data/licenceNumberData';
import { Combobox } from './components/ui/Combobox';

const parseOptionalPrice = (value: unknown) => {
  const rawValue = String(value ?? '').trim();

  if (!rawValue) {
    return undefined;
  }

  const compactValue = rawValue.replace(/[\s\u00a0]/g, '');
  const priceLikeValue = compactValue.replace(/[^\d.,-]/g, '');

  if (!priceLikeValue) {
    return Number.NaN;
  }

  const isNegative = priceLikeValue.startsWith('-');
  const unsignedValue = priceLikeValue.replace(/-/g, '');
  const decimalSeparatorIndex = Math.max(
    unsignedValue.lastIndexOf(','),
    unsignedValue.lastIndexOf('.')
  );

  const normalizedValue = decimalSeparatorIndex === -1
    ? unsignedValue.replace(/\D/g, '')
    : [
        unsignedValue.slice(0, decimalSeparatorIndex).replace(/\D/g, ''),
        unsignedValue.slice(decimalSeparatorIndex + 1).replace(/\D/g, ''),
      ].join('.');

  if (!normalizedValue || normalizedValue === '.') {
    return Number.NaN;
  }

  return Number(`${isNegative ? '-' : ''}${normalizedValue}`);
};

const App: React.FC = () => {
  const today = new Date().toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      requestDate: new Date().toLocaleDateString('ru-RU'),
      items: [{ name: '', purpose: '', licensePlate: '', quantity: '1', price: undefined }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  });

  const initiatorName = watch('initiatorName');
  const matchingInitiator = INITIATORS.find(i => i.name === initiatorName);
  const isPositionReadonly = !!matchingInitiator;

  // Update position when initiator changes from the list
  React.useEffect(() => {
    if (matchingInitiator) {
      setValue('initiatorPosition', matchingInitiator.position);
    }
  }, [matchingInitiator, setValue]);

  const onSubmit = async (data: FormData) => {
    try {
      const response = await fetch('/repair/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Ошибка при отправке заявки');
      }

      alert('Заявка успешно отправлена!');
    } catch (error) {
      console.error('Submission error:', error);
      alert('Произошла ошибка при отправке заявки. Пожалуйста, попробуйте позже.');
    }
  };

  const onErrors: SubmitErrorHandler<FormData> = (errors) => {
    console.error(errors);
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] py-4 px-4 sm:py-8 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-5xl mx-auto">
        {/* Header Section */}
        <header className="flex flex-row gap-2 mb-4 space-y-4 sm:items-center justify-between gap-4">
              <a href="/">
              <img src="/logo.svg" alt="logo" className='h-8' />
              </a>
            <div className="flex flex-col sm:items-end">
              <h1 className="text-xl font-bold text-gray-900 uppercase">Новая заявка</h1>
              <p className="text-sm text-gray-500">{today}</p>
            </div>
        </header>

        <form onSubmit={handleSubmit(onSubmit, onErrors)} className="space-y-6">
          {/* Hidden Date for Schema */}
          <input type="hidden" {...register('requestDate')} />

          {/* Main Info Card */}
          <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Участок */}
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

              {/* Номер заявки */}
              <div>
                <label className="text-[11px] uppercase font-bold text-gray-500 mb-1.5 block">Номер заявки</label>
                <input type="text" {...register('requestNo')} className="resource-input text-sm" placeholder="Например, Б125" />
                {errors.requestNo && <p className="mt-1 text-xs text-red-500">{errors.requestNo.message}</p>}
              </div>

              {/* Инициатор (Combined Name and Position) */}
              <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="text-[11px] uppercase font-bold text-gray-500 mb-1.5 block">Инициатор</label>
                  <Controller
                    name="initiatorName"
                    control={control}
                    render={({ field }) => (
                      <Combobox
                        options={INITIATORS.map(i => i.name)}
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
            </div>
          </div>

          {/* Items Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-gray-400" />
                <h2 className="text-sm font-bold uppercase text-gray-700 tracking-wide">Позиции в заявке</h2>
              </div>
            </div>

            {fields.map((field, index) => (
              <div key={field.id} className="bg-white p-5 rounded-lg border border-gray-200 relative group transition-all">
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
                    {errors.items?.[index]?.name && <p className="mt-1 text-[10px] text-red-500">{errors.items[index]?.name?.message}</p>}
                  </div>

                  {/* Цель */}
                  <div className="sm:col-span-3">
                    <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Цель покупки</label>
                    <input type="text" {...register(`items.${index}.purpose`)} className="resource-input text-sm" placeholder="Для чего..." />
                    {errors.items?.[index]?.purpose && <p className="mt-1 text-[10px] text-red-500">{errors.items[index]?.purpose?.message}</p>}
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
                    {errors.items?.[index]?.licensePlate && <p className="mt-1 text-[10px] text-red-500">{errors.items[index]?.licensePlate?.message}</p>}
                  </div>

                  {/* Кол-во и Цена */}
                  <div className="sm:col-span-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Кол-во</label>
                      <input
                        type="text"
                        {...register(`items.${index}.quantity`)}
                        className="resource-input text-sm"
                      />
                    </div>
                    <div className="relative">
                      <label className="text-[11px] uppercase font-bold text-gray-400 mb-1 block">Цена</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        {...register(`items.${index}.price`, {
                          setValueAs: parseOptionalPrice,
                        })}
                        className="resource-input text-sm"
                      />
                      {errors.items?.[index]?.price && <p className="mt-1 text-[10px] text-red-500">{errors.items[index]?.price?.message}</p>}
                      {fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => remove(index)}
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
            ))}
            {errors.items?.root && <p className="text-red-500 text-xs font-bold uppercase">{errors.items.root.message}</p>}

            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => append({ name: '', purpose: '', licensePlate: '', quantity: '1', price: undefined })}
                className="bg-white border-2 border-dashed border-gray-200 hover:border-resource-primary hover:text-resource-primary text-gray-400 w-full py-4 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Plus className="w-5 h-5" />
                Добавить позицию
              </button>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4">
            <p className="text-[11px] text-gray-400 uppercase font-medium text-center sm:text-left">
              Нажимая кнопку, вы подтверждаете <br /> корректность введенных данных
            </p>
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-gray-900 text-white px-8 py-3 rounded-lg font-bold uppercase text-xs tracking-widest hover:bg-black transition-all disabled:opacity-50 flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              Отправить заявку
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default App;
