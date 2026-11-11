// Форма серии списаний по одной партии (этап 6). react-hook-form + zodResolver(WriteOffSchema(lot)).
// useFieldArray name='rows' (старт [EMPTY_WRITEOFF_ROW]). Бегущий остаток считается на КЛИЕНТЕ
// (канон §3.1, EPS): useWatch на rows → running[i] = lot.balance − Σ amount[0..i-1], округление до 3.
// onSubmit → createWriteoffs(lot.id, rows); 409 → «Больше остатка»; 404 → «Партия недоступна».

import React from 'react';
import {
  useForm,
  useFieldArray,
  useWatch,
  FormProvider,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, MinusCircle, X } from 'lucide-react';
import { WriteOffSchema, EMPTY_WRITEOFF_ROW } from '../../lib/gsmSchemas';
import type { WriteOffData } from '../../lib/gsmSchemas';
import { parseQuantity } from '../../lib/parseQuantity';
import { createWriteoffs, getActiveSites } from '../../lib/gsmApi';
import { todayMsk } from '../../lib/gsmDates';
import { ApiError } from '../../lib/gsmApi';
import type { Lot } from '../../lib/gsmTypes';
import { SubmitFooter } from '../SubmitFooter';
import WriteOffRow from './WriteOffRow';

interface WriteOffFormProps {
  lot: Lot;
  onSaved: () => void;
  onCancel: () => void;
  // frameless — вариант для модалки: без своей рамки/фона и шапки с крестиком
  // (их даёт Modal), вместо шапки — строка «Остаток: …».
  frameless?: boolean;
}

// Кол-во без хвостовых нулей: 12.500 → 12.5.
const fmtQty = (n: number): string => String(Math.round(n * 1000) / 1000);

// round3 — тот же приём, что на беке (канон §3.1).
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const WriteOffForm: React.FC<WriteOffFormProps> = ({
  lot,
  onSaved,
  onCancel,
  frameless = false,
}) => {
  const [formError, setFormError] = React.useState<string | null>(null);

  const [allowBackdatedWriteoffs, setAllowBackdatedWriteoffs] = React.useState<boolean | null>(null);
  const [policyError, setPolicyError] = React.useState(false);
  const [policyReload, setPolicyReload] = React.useState(0);

  // Читаем актуальное правило при каждом открытии формы, а не из сессии.
  React.useEffect(() => {
    let alive = true;
    void getActiveSites().then((sites) => {
      if (!alive) return;
      const site = sites.find((s) => s.id === lot.siteId);
      if (!site) {
        setPolicyError(true);
        return;
      }
      setAllowBackdatedWriteoffs(site.allowBackdatedWriteoffs);
      setPolicyError(false);
    }, () => {
      if (alive) setPolicyError(true);
    });
    return () => {
      alive = false;
    };
  }, [lot.siteId, policyReload]);

  const methods = useForm<WriteOffData>({
    resolver: zodResolver(WriteOffSchema(lot, allowBackdatedWriteoffs === true)),
    defaultValues: { rows: [{ ...EMPTY_WRITEOFF_ROW, date: todayMsk() }] } as WriteOffData,
  });

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const { fields, append, remove } = useFieldArray({ control, name: 'rows' });

  // Бегущий остаток (на клиенте). useWatch на rows → массив running по строкам.
  // amount уже number (setValueAs=parseQuantity); пустое/NaN считаем как 0.
  const watchedRows = useWatch({ control, name: 'rows' });

  const running = React.useMemo<number[]>(() => {
    const result: number[] = [];
    let acc = lot.balance;
    const rows = watchedRows ?? [];
    for (let i = 0; i < fields.length; i += 1) {
      const raw = rows[i]?.amount as unknown;
      const amount =
        typeof raw === 'number' ? raw : parseQuantity(raw);
      const safe = Number.isFinite(amount) && amount > 0 ? amount : 0;
      acc -= safe;
      result.push(round3(acc));
    }
    return result;
  }, [watchedRows, fields.length, lot.balance]);

  const onSubmit = async (data: WriteOffData) => {
    setFormError(null);
    if (allowBackdatedWriteoffs === null) return;
    try {
      await createWriteoffs(
        lot.id,
        data.rows.map((r) => ({
          date: r.date,
          licensePlate: r.plate,
          amount: r.amount,
          reason: r.reason,
        }))
      );
      onSaved();
    } catch (err) {
      // createWriteoffs пробрасывает 409 как {status:409, balance?}.
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 409) {
        const balance = (err as { balance?: number }).balance;
        setFormError(
          balance !== undefined
            ? `Больше остатка (${fmtQty(balance)} ${lot.unit})`
            : 'Больше остатка'
        );
      } else if (err instanceof ApiError && err.message === 'backdating_forbidden') {
        setAllowBackdatedWriteoffs(false);
        setFormError('Менеджер запретил списания задним числом. Выберите сегодняшнюю дату.');
      } else if (err instanceof ApiError && err.status === 404) {
        setFormError('Партия недоступна');
      } else {
        setFormError('Не удалось сохранить. Попробуйте позже.');
      }
    }
  };

  return (
    <FormProvider {...methods}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className={
          frameless
            ? 'space-y-4'
            : 'rounded-lg border border-gray-200 bg-[#F9FAFB] p-4 sm:p-5 space-y-4'
        }
      >
        {/* Шапка — только в инлайн-варианте (в модалке заголовок/крестик даёт Modal) */}
        {frameless ? (
          <p className="text-[11px] uppercase font-bold text-gray-400">
            Остаток: {fmtQty(lot.balance)} {lot.unit}
          </p>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-gray-700">
              <MinusCircle className="w-5 h-5 text-gray-400" />
              <h2 className="text-sm font-bold uppercase tracking-wide">
                Списание: {lot.name}{' '}
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
        )}

        {allowBackdatedWriteoffs === null && (
          <div role="status" className="text-sm text-gray-500">
            {policyError ? 'Не удалось загрузить правила списания.' : 'Загрузка правил списания…'}
            {policyError && <button type="button" className="resource-button-secondary ml-3" onClick={() => setPolicyReload((n) => n + 1)}>Повторить</button>}
          </div>
        )}
        {allowBackdatedWriteoffs === false && (
          <p className="text-sm text-gray-500">Менеджер разрешил списания только сегодняшним числом по Москве.</p>
        )}
        <fieldset disabled={allowBackdatedWriteoffs === null} className="space-y-4 disabled:opacity-50">
          {/* Строки */}
          <div className="space-y-4">
            {fields.map((field, index) => (
              <WriteOffRow
                key={field.id}
                index={index}
                lot={lot}
                allowBackdatedWriteoffs={allowBackdatedWriteoffs === true}
                running={running[index] ?? lot.balance}
                canRemove={fields.length > 1}
                onRemove={() => remove(index)}
              />
            ))}
          </div>

          {/* Добавить строку */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => append({ ...EMPTY_WRITEOFF_ROW, date: todayMsk() })}
              className="bg-white border-2 border-dashed border-gray-200 hover:border-resource-primary hover:text-resource-primary text-gray-400 w-full py-4 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              Добавить строку
            </button>
          </div>
        </fieldset>

        {formError && (
          <p className="text-xs font-bold text-red-500">{formError}</p>
        )}

        {/* Футер: отмена + сохранить */}
        <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={onCancel}
            className="resource-button-secondary w-full sm:w-auto"
          >
            Отмена
          </button>
          <fieldset disabled={allowBackdatedWriteoffs === null} className="flex-1 w-full">
            <SubmitFooter isSubmitting={isSubmitting} label="Сохранить списание" />
          </fieldset>
        </div>
      </form>
    </FormProvider>
  );
};

export default WriteOffForm;
