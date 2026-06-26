// Генератор пароля сотрудника (дизайн-правки этого раунда).
// Набор без похожих символов: нет 0 O o 1 l I. Источник случайности — crypto
// (crypto.getRandomValues; Math.random запрещён). Длина по умолчанию 8.

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genPassword(len = 8): string {
  const n = Math.max(0, Math.floor(len));
  if (n === 0) return '';

  const bytes = new Uint32Array(n);
  crypto.getRandomValues(bytes);

  let out = '';
  for (let i = 0; i < n; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
