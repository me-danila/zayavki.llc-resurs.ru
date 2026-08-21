// Модальное окно — единое для всех действий ГСМ-UI (правка/отмена прихода и
// списания, перемещение). Dialog из @headlessui/react (уже в deps): затемнённый
// оверлей, центрированная панель, Escape и клик по оверлею закрывают, фокус-трап.
// Шапка: заголовок в стиле секций проекта + кнопка-крестик. Содержимое — children.

import React from 'react';
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  // Широкая панель (формы с грид-раскладкой, напр. перемещение).
  wide?: boolean;
  children?: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  wide = false,
  children,
}) => (
  <Dialog open={open} onClose={onClose} className="relative z-50">
    <DialogBackdrop className="fixed inset-0 bg-black/30" />
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
      <DialogPanel
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} rounded-lg bg-white p-4 shadow-xl sm:p-6`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <DialogTitle className="text-sm font-bold uppercase tracking-wide text-gray-700">
            {title}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            title="Закрыть"
            className="-m-1 p-1 text-gray-300 transition-colors hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </DialogPanel>
    </div>
  </Dialog>
);

export default Modal;
