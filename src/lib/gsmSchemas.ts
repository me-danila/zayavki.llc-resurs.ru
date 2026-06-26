// Zod-схемы фронта ГСМ (отдельно от src/types.ts — это другой домен).
// Канон §3: даты YYYY-MM-DD/TZ MSK, EPS=1e-9, нарастающая сумма списаний ≤ остатка.
// Количество парсится parseQuantity в number (setValueAs при register).

import { z } from 'zod';
import { todayMsk } from './gsmDates';
import type { Lot } from './gsmTypes';
// NB: parseQuantity (src/lib/parseQuantity.ts) применяется на стороне формы через
// register(..., { setValueAs: parseQuantity }) — здесь quantity/amount уже number.

// Канон §3.1 — тот же эпсилон, что на беке и в расчёте бегущего остатка.
export const EPS = 1e-9;

// --- Вход ---

export const LoginSchema = z.object({
  username: z.string().min(1, 'Введите логин'),
  password: z.string().min(1, 'Введите пароль'),
});
export type LoginData = z.infer<typeof LoginSchema>;

// --- Приход (manager) ---

// quantity: input — строка из инпута, через setValueAs(parseQuantity) приходит number.
// Поэтому валидируем уже number: positive отбракует NaN и <=0.
export const ReceiptRowSchema = z.object({
  date: z
    .string()
    .min(1, 'Укажите дату')
    .refine((d) => d <= todayMsk(), 'Дата не может быть в будущем'),
  siteName: z.string().min(1, 'Выберите участок'),
  name: z.string().min(1, 'Укажите наименование'),
  code: z.string().min(1, 'Укажите код'),
  unit: z.string().min(1, 'Укажите ед. изм.').default('л'),
  quantity: z
    .number({ message: 'Введите число' })
    .positive('Должно быть больше 0'),
});
export type ReceiptRowData = z.infer<typeof ReceiptRowSchema>;

export const ReceiptSchema = z.object({
  rows: z.array(ReceiptRowSchema).min(1, 'Добавьте хотя бы одну строку'),
});
export type ReceiptData = z.infer<typeof ReceiptSchema>;

// --- Списание (worker) — фабрика, привязанная к конкретной партии lot ---

// Базовая строка зависит от lot: дата ∈ [receivedDate, today], сумма > 0.
export function WriteOffRowSchema(lot: Lot) {
  const today = todayMsk();
  return z.object({
    date: z
      .string()
      .min(1, 'Укажите дату')
      .refine((d) => d >= lot.receivedDate, 'Раньше даты прихода')
      .refine((d) => d <= today, 'Дата не может быть в будущем'),
    plate: z.string().min(1, 'Укажите № авто'),
    amount: z
      .number({ message: 'Введите число' })
      .positive('Должно быть больше 0'),
    reason: z.string().min(1, 'Укажите причину'),
  });
}
export type WriteOffRowData = z.infer<ReturnType<typeof WriteOffRowSchema>>;

// Серия списаний по партии. superRefine проверяет НАРАСТАЮЩУЮ сумму:
// после каждой строки накопленный итог не должен превышать lot.balance (с EPS).
// Ошибка вешается на rows.i.amount — на ту строку, что вывела за остаток.
export function WriteOffSchema(lot: Lot) {
  return z
    .object({
      rows: z.array(WriteOffRowSchema(lot)).min(1, 'Добавьте хотя бы одну строку'),
    })
    .superRefine((val, ctx) => {
      let running = 0;
      val.rows.forEach((row, i) => {
        const amount = typeof row.amount === 'number' ? row.amount : Number.NaN;
        if (!Number.isFinite(amount) || amount <= 0) return; // отдельная ошибка уже есть
        running += amount;
        if (running > lot.balance + EPS) {
          ctx.addIssue({
            code: 'custom',
            path: ['rows', i, 'amount'],
            message: `Больше остатка (${lot.balance})`,
          });
        }
      });
    });
}
export type WriteOffData = z.infer<ReturnType<typeof WriteOffSchema>>;

// --- Пустые строки для useFieldArray (append/defaultValues) ---
// quantity/amount хранятся строкой в инпуте до setValueAs; типизируем как any,
// чтобы default '' не конфликтовал с number-выходом схемы.

export const EMPTY_RECEIPT_ROW = {
  date: todayMsk(),
  siteName: '',
  name: '',
  code: '',
  unit: 'л',
  quantity: '',
} as unknown as ReceiptRowData;

export const EMPTY_WRITEOFF_ROW = {
  date: todayMsk(),
  plate: '',
  amount: '',
  reason: '',
} as unknown as WriteOffRowData;
