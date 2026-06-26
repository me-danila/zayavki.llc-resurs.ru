// Парсер количества для register({ setValueAs }) — по образцу parseOptionalPrice,
// но ОБЯЗАТЕЛЬНЫЙ: пустая строка → NaN, мусор → NaN (а не undefined).
// Поддерживает запятую/точку как десятичный разделитель и пробелы-разделители тысяч.
// Дальше zod (z.number().positive()) отбракует NaN/<=0 с понятным сообщением.

export const parseQuantity = (value: unknown): number => {
  const rawValue = String(value ?? '').trim();

  if (!rawValue) {
    return Number.NaN;
  }

  const compactValue = rawValue.replace(/[\s ]/g, '');
  const numberLikeValue = compactValue.replace(/[^\d.,-]/g, '');

  if (!numberLikeValue) {
    return Number.NaN;
  }

  const isNegative = numberLikeValue.startsWith('-');
  const unsignedValue = numberLikeValue.replace(/-/g, '');
  const decimalSeparatorIndex = Math.max(
    unsignedValue.lastIndexOf(','),
    unsignedValue.lastIndexOf('.')
  );

  const normalizedValue = decimalSeparatorIndex === -1
    ? unsignedValue.replace(/\D/g, '')
    : [
        unsignedValue.slice(0, decimalSeparatorIndex).replace(/\D/g, ''),
        unsignedValue.slice(decimalSeparatorIndex + 1).replace(/\D/g, ''),
      ].join('.');

  if (!normalizedValue || normalizedValue === '.') {
    return Number.NaN;
  }

  return Number(`${isNegative ? '-' : ''}${normalizedValue}`);
};
