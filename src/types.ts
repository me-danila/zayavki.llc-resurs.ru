import { z } from 'zod';

export const ItemSchema = z.object({
  name: z.string().min(1, "Обязательное поле"),
  purpose: z.string().min(1, "Обязательное поле"),
  licensePlate: z.string().min(1, "Обязательное поле"),
  quantity: z.string().min(1, "Обязательное поле"),
  price: z.number().positive("Должно быть больше 0").optional().nullable(),
});

export const FormSchema = z.object({
  site: z.string().min(1, "Выберите участок"),
  requestNo: z.string().min(1, "Введите номер заявки"),
  requestDate: z.string(),
  initiatorName: z.string().min(1, "Введите ФИО"),
  initiatorPosition: z.string().min(1, "Введите должность"),
  items: z.array(ItemSchema).min(1, "Добавьте хотя бы одну позицию"),
});

export type FormData = z.infer<typeof FormSchema>;
export type ItemData = z.infer<typeof ItemSchema>;
