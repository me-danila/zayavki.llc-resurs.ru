import type { ItemData } from './types';

export const SITES = [
  "Участок №1 (Север)",
  "Участок №2 (Центр)",
  "Участок №3 (Юг)",
  "Склад готовой продукции",
];

export const EMPTY_ITEM: ItemData = {
  name: '',
  purpose: '',
  licensePlate: '',
  quantity: '1',
  price: undefined,
};
