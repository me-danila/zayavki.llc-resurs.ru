// Сворачиваемая секция (дизайн-правки этого раунда). Заголовок-кнопка с шевроном
// (ChevronRight закрыто → ChevronDown открыто), по клику разворачивает содержимое.
// Стиль заголовка — как заголовки секций ГСМ: uppercase, иконка-акцент (шеврон),
// серый текст. Опциональный right (например кнопка «+») рендерится справа от
// заголовка; клик по нему НЕ сворачивает секцию (stopPropagation).

import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** Управляемый режим: если передан, секция открыта/закрыта снаружи. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  right?: React.ReactNode;
  children?: React.ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  right,
  children,
}) => {
  const [openState, setOpenState] = React.useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const setOpen = (next: boolean) => {
    if (!isControlled) setOpenState(next);
    onOpenChange?.(next);
  };
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-gray-900"
        >
          <Chevron className="h-4 w-4 shrink-0 text-gray-400" />
          <span className="truncate text-sm font-bold uppercase tracking-wide text-gray-700">
            {title}
          </span>
        </button>
        {right !== undefined && right !== null && (
          <span
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {right}
          </span>
        )}
      </div>
      {open && <div className="border-t border-gray-100 p-4">{children}</div>}
    </div>
  );
};

export default CollapsibleSection;
