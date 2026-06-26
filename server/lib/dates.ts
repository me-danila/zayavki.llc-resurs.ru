// Работа с датами: только день (YYYY-MM-DD), время не учитываем.
// «Сегодня» считаем в TZ Europe/Moscow.

// Текущая дата в МСК в формате YYYY-MM-DD.
// 'sv-SE' даёт ISO-формат с дефисами, timeZone фиксирует МСК.
export function todayMsk(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
  }).format(new Date());
}

// Проверка формата ____-__-__ (4 цифры, дефис, 2 цифры, дефис, 2 цифры).
export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Лексикографическое сравнение дат YYYY-MM-DD: для этого формата
// строковый порядок совпадает с хронологическим.
export function lte(a: string, b: string): boolean {
  return a <= b;
}

export function gte(a: string, b: string): boolean {
  return a >= b;
}
