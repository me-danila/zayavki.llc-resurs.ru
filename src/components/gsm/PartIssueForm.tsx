// Форма расхода штучных материалов (механик). Несколько позиций за раз, одной
// транзакцией — как форма прихода у менеджера.
//
// Дата не редактируется: её ставит сервер (сегодня по МСК), поле показано read-only
// просто чтобы механик видел, каким числом уйдёт запись. Участок тоже серверный —
// в форме его нет вовсе.
//
// Гос. номер — Combobox по общему справочнику LICENSE_PLATES (тот же, что в списании
// ГСМ и в форме заявки). Остальные поля — свободный ввод.

import React from 'react';
import { Loader2, Plus, Send, Trash2 } from 'lucide-react';
import * as api from '../../lib/gsmApi';
import { ApiError } from '../../lib/gsmApi';
import { LICENSE_PLATES } from '../../data/licenceNumberData';
import { todayMsk } from '../../lib/gsmDates';
import { Combobox } from '../ui/Combobox';

export interface PartIssueFormProps {
  // Вызывается после успешного сохранения серии (родитель обновляет список).
  onSaved: () => void | Promise<void>;
}

type Row = {
  partNumber: string;
  name: string;
  qty: string;
  licensePlate: string;
  recipient: string;
};

const EMPTY_ROW: Row = {
  partNumber: '',
  name: '',
  qty: '',
  licensePlate: '',
  recipient: '',
};

// Количество — только целые штуки: это условие и в схеме БД (CHECK), и на сервере.
function parseQty(raw: string): number | null {
  const n = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

const PartIssueForm: React.FC<PartIssueFormProps> = ({ onSaved }) => {
  const [rows, setRows] = React.useState<Row[]>([{ ...EMPTY_ROW }]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const today = React.useMemo(() => todayMsk(), []);

  const patchRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  };

  const addRow = () => setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  const removeRow = (index: number) =>
    setRows((prev) => prev.filter((_, i) => i !== index));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const payload: Array<{
      partNumber: string;
      name: string;
      qty: number;
      licensePlate: string;
      recipient: string;
    }> = [];

    for (const [i, r] of rows.entries()) {
      const qty = parseQty(r.qty);
      if (
        !r.partNumber.trim() ||
        !r.name.trim() ||
        qty === null ||
        !r.licensePlate.trim() ||
        !r.recipient.trim()
      ) {
        setError(
          `Строка ${i + 1}: заполните все поля, количество — целое число больше нуля.`,
        );
        return;
      }
      payload.push({
        partNumber: r.partNumber.trim(),
        name: r.name.trim(),
        qty,
        licensePlate: r.licensePlate.trim(),
        recipient: r.recipient.trim(),
      });
    }

    setSubmitting(true);
    try {
      await api.createPartIssues(payload);
      setRows([{ ...EMPTY_ROW }]);
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('Вносить расход может только механик участка.');
      } else if (err instanceof ApiError && err.status === 400) {
        setError('Проверьте поля: все обязательны, количество — целое.');
      } else {
        setError('Не удалось сохранить. Попробуйте позже.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-gray-200 bg-white p-5 sm:p-6 space-y-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="resource-label">Дата</label>
          <input
            type="text"
            value={today}
            readOnly
            className="resource-input w-40 bg-gray-50 text-sm text-gray-500"
          />
        </div>
        <p className="text-[11px] text-gray-400">
          Дата ставится автоматически — задним числом внести нельзя.
        </p>
      </div>

      <div className="space-y-4">
        {rows.map((row, index) => (
          <div
            key={index}
            className="relative rounded-lg border border-gray-200 bg-gray-50 p-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
              <div className="sm:col-span-3">
                <label className="resource-label">Номер детали</label>
                <input
                  type="text"
                  value={row.partNumber}
                  onChange={(e) => patchRow(index, { partNumber: e.target.value })}
                  autoComplete="off"
                  className="resource-input text-sm"
                  placeholder="Напр. 740.1003213"
                />
              </div>

              <div className="sm:col-span-4">
                <label className="resource-label">Наименование</label>
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => patchRow(index, { name: e.target.value })}
                  autoComplete="off"
                  className="resource-input text-sm"
                  placeholder="Напр. Прокладка ГБЦ"
                />
              </div>

              <div className="sm:col-span-1">
                <label className="resource-label">Кол-во</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={row.qty}
                  onChange={(e) => patchRow(index, { qty: e.target.value })}
                  className="resource-input text-sm"
                  placeholder="0"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="resource-label">Гос. номер</label>
                <Combobox
                  options={LICENSE_PLATES}
                  value={row.licensePlate}
                  onChange={(v) => patchRow(index, { licensePlate: v })}
                  placeholder="Номер..."
                />
              </div>

              <div className="sm:col-span-2">
                <label className="resource-label">Получил</label>
                <input
                  type="text"
                  value={row.recipient}
                  onChange={(e) => patchRow(index, { recipient: e.target.value })}
                  autoComplete="off"
                  className="resource-input text-sm"
                  placeholder="Иванов И.И."
                />
              </div>
            </div>

            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(index)}
                title="Удалить строку"
                className="absolute right-2 top-2 p-1 text-gray-300 transition-colors hover:text-red-500"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-3 text-xs font-bold uppercase tracking-widest text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-900"
      >
        <Plus className="w-4 h-4" />
        Добавить позицию
      </button>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="flex h-11 items-center gap-2 rounded-lg bg-gray-900 px-6 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-black disabled:opacity-50"
        >
          Сохранить расход
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </form>
  );
};

export default PartIssueForm;
