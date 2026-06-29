// Форма прихода (manager). useForm + zodResolver(ReceiptSchema), FormProvider,
// useFieldArray name='rows' (старт [EMPTY_RECEIPT_ROW]). Рендерит ReceiptRow.
// onSubmit → маппинг полей формы (date→receivedDate, siteName→siteId через список
// активных участков sites) → payload контракта §4 → createReceipts(rows).
// Если участок строки не нашёлся среди активных — inline-ошибка (без запроса).
// Успех → reset к одной пустой строке + onSaved(). Ошибки 400 — inline-баннер.

import React from 'react';
import { useForm, FormProvider, useFieldArray } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Truck } from 'lucide-react';
import { ReceiptSchema, EMPTY_RECEIPT_ROW } from '../../lib/gsmSchemas';
import type { ReceiptData } from '../../lib/gsmSchemas';

// Вход формы: unit имеет .default('л') в схеме → в z.input он опционален.
// Выход (после zodResolver) — ReceiptData с unit:string. Третий generic useForm
// фиксирует трансформированный тип, чтобы handleSubmit отдавал ReceiptData.
type ReceiptFormInput = {
  rows: Array<{
    date: string;
    siteName: string;
    name: string;
    code: string;
    unit?: string;
    quantity: number;
  }>;
};
import * as api from '../../lib/gsmApi';
import { ApiError } from '../../lib/gsmApi';
import type { ReceiptRowPayload } from '../../lib/gsmApi';
import { SubmitFooter } from '../SubmitFooter';
import { ReceiptRow } from './ReceiptRow';

export interface ReceiptFormProps {
  // Вызывается после успешного сохранения прихода (менеджер рефетчит партии).
  onSaved: () => void;
  // Активные участки — опции комбобокса участка и источник для name→siteId.
  sites: Array<{ id: number; name: string }>;
}

const ReceiptForm: React.FC<ReceiptFormProps> = ({ onSaved, sites }) => {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [okMessage, setOkMessage] = React.useState<string | null>(null);

  const methods = useForm<ReceiptFormInput, unknown, ReceiptData>({
    resolver: zodResolver(ReceiptSchema) as unknown as Resolver<
      ReceiptFormInput,
      unknown,
      ReceiptData
    >,
    defaultValues: { rows: [{ ...EMPTY_RECEIPT_ROW }] },
  });

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = methods;

  const { fields, append, remove } = useFieldArray({ control, name: 'rows' });

  // Имя участка → siteId (по активным участкам). Сравнение по trim, регистр учитываем
  // как есть — комбобокс отдаёт ровно выбранное имя из списка.
  const siteIdByName = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sites) m.set(s.name.trim(), s.id);
    return m;
  }, [sites]);

  const onSubmit = async (data: ReceiptData) => {
    setFormError(null);
    setOkMessage(null);
    // Маппинг формы → контракт §4: date→receivedDate, siteName→siteId.
    const rows: ReceiptRowPayload[] = [];
    for (const r of data.rows) {
      const siteId = siteIdByName.get(r.siteName.trim());
      if (siteId === undefined) {
        setFormError('Выберите участок из списка для каждой позиции.');
        return;
      }
      rows.push({
        receivedDate: r.date,
        siteId,
        name: r.name,
        code: r.code,
        unit: r.unit,
        quantity: r.quantity,
      });
    }

    try {
      const { created } = await api.createReceipts(rows);
      reset({ rows: [{ ...EMPTY_RECEIPT_ROW }] });
      setOkMessage(`Добавлено партий: ${created}`);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setFormError('Проверьте поля: некоторые данные некорректны.');
      } else {
        setFormError('Не удалось сохранить приход. Попробуйте позже.');
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Truck className="w-5 h-5 text-gray-400" />
        <h2 className="text-sm font-bold uppercase text-gray-700 tracking-wide">Приход ГСМ</h2>
      </div>

      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {fields.map((field, index) => (
            <ReceiptRow
              key={field.id}
              index={index}
              canRemove={fields.length > 1}
              onRemove={() => remove(index)}
              sites={sites}
            />
          ))}
          {errors.rows?.root && (
            <p className="text-red-500 text-xs font-bold uppercase">
              {errors.rows.root.message}
            </p>
          )}

          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => append({ ...EMPTY_RECEIPT_ROW })}
              className="bg-white border-2 border-dashed border-gray-200 hover:border-resource-primary hover:text-resource-primary text-gray-400 w-full py-4 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              Добавить позицию
            </button>
          </div>

          {formError && <p className="text-xs text-red-500">{formError}</p>}
          {okMessage && <p className="text-xs text-green-600">{okMessage}</p>}

          <SubmitFooter isSubmitting={isSubmitting} label="Сохранить приход" />
        </form>
      </FormProvider>
    </div>
  );
};

export default ReceiptForm;
