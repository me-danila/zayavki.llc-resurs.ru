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

// Дата для показа: YYYY-MM-DD → ДД.ММ.ГГГГ. Хранение и API остаются ISO —
// формат меняем только на выводе. Пустую/непонятную строку отдаём как есть.
export function formatRu(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}
