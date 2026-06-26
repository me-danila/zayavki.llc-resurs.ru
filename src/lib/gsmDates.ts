// Даты ГСМ: только день YYYY-MM-DD, TZ Europe/Moscow (канон §3.2). Время не выводим.
// 'sv-SE' даёт ISO-формат YYYY-MM-DD. Тот же приём, что и на сервере (server/lib/dates.ts).

const MSK_FORMATTER = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// «Сегодня» в Москве как YYYY-MM-DD.
export function todayMsk(): string {
  return MSK_FORMATTER.format(new Date());
}

// Лексикографическое сравнение дат YYYY-MM-DD (формат сортируем как строки).
// a <= b
export function dateLte(a: string, b: string): boolean {
  return a <= b;
}

// a >= b
export function dateGte(a: string, b: string): boolean {
  return a >= b;
}
