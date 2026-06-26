// In-memory rate-limit логина (канон §3.5): ≤5 неудач / 15 мин на ключ.
// Ключ обычно = `${username}|${ip}`. Без внешних зависимостей, без БД —
// процесс один, перезапуск сбрасывает счётчики (приемлемо).

const WINDOW_MS = 15 * 60 * 1000; // 15 минут
const MAX_FAILURES = 5;

type Bucket = { count: number; firstAt: number };

const buckets = new Map<string, Bucket>();

// Сколько ещё «живой» бакет (не истёкшее окно). null — окна нет/истекло.
function activeBucket(key: string, now: number): Bucket | null {
  const b = buckets.get(key);
  if (!b) return null;
  if (now - b.firstAt >= WINDOW_MS) {
    buckets.delete(key);
    return null;
  }
  return b;
}

// Можно ли пытаться войти под этим ключом? true — лимит не превышен.
// Чистый предикат: счётчик не меняет (фиксируем неудачу отдельно).
export function loginLimiter(key: string): boolean {
  const b = activeBucket(key, Date.now());
  return !b || b.count < MAX_FAILURES;
}

// Зафиксировать неудачную попытку. Возвращает true, если после инкремента
// лимит ещё не превышен (можно продолжать), false — заблокирован.
export function registerFailure(key: string): boolean {
  const now = Date.now();
  const b = activeBucket(key, now);
  if (!b) {
    buckets.set(key, { count: 1, firstAt: now });
    return 1 < MAX_FAILURES;
  }
  b.count += 1;
  return b.count < MAX_FAILURES;
}

// Сбросить счётчик при успешном входе.
export function resetFailures(key: string): void {
  buckets.delete(key);
}
