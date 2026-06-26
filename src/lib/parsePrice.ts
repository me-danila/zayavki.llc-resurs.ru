export const parseOptionalPrice = (value: unknown) => {
  const rawValue = String(value ?? '').trim();

  if (!rawValue) {
    return undefined;
  }

  const compactValue = rawValue.replace(/[\s ]/g, '');
  const priceLikeValue = compactValue.replace(/[^\d.,-]/g, '');

  if (!priceLikeValue) {
    return Number.NaN;
  }

  const isNegative = priceLikeValue.startsWith('-');
  const unsignedValue = priceLikeValue.replace(/-/g, '');
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
