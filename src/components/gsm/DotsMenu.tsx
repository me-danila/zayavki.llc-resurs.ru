// Кнопка «…» с выпадающим меню действий (общая для StockTable и LotHistory).
// Без новых зависимостей: Popover из @radix-ui/react-popover (уже в deps,
// используется в Combobox) — портал спасает от обрезки overflow-x-auto таблицы,
// клик вне и Escape закрывают из коробки. Danger-пункты — красные.

import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';

export interface DotsMenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

export interface DotsMenuProps {
  items: DotsMenuItem[];
  title?: string;
}

const DotsMenu: React.FC<DotsMenuProps> = ({ items, title = 'Действия' }) => {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide transition-colors ${
                it.danger
                  ? 'text-red-500 hover:bg-red-50'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="shrink-0 text-current">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default DotsMenu;
