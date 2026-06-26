// Float-эпсилон и хелперы сравнения количеств/денег.
// EPS и округление до 3 знаков обязаны совпадать на беке, в SQL-фильтрах и на фронте.

export const EPS = 1e-9;

// Округление до 3 знаков после запятой.
export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

// a >= b с допуском EPS.
export function gte(a: number, b: number): boolean {
  return a >= b - EPS;
}

// a > b с допуском EPS.
export function gt(a: number, b: number): boolean {
  return a > b + EPS;
}

// Строго положительное (активная партия: balance > EPS).
export function isPositive(n: number): boolean {
  return n > EPS;
}

// Ноль или меньше (архив: balance <= EPS).
export function isZeroOrLess(n: number): boolean {
  return n <= EPS;
}
