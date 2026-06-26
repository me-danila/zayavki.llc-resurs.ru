import React from 'react';
import { Send } from 'lucide-react';

interface SubmitFooterProps {
  isSubmitting: boolean;
  label?: string;
}

export const SubmitFooter: React.FC<SubmitFooterProps> = ({
  isSubmitting,
  label = 'Отправить заявку',
}) => (
  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4">
    <p className="text-[11px] text-gray-400 uppercase font-medium text-center sm:text-left">
      Нажимая кнопку, вы подтверждаете <br /> корректность введенных данных
    </p>
    <button
      type="submit"
      disabled={isSubmitting}
      className="bg-gray-900 text-white px-8 py-3 rounded-lg font-bold uppercase text-xs tracking-widest hover:bg-black transition-all disabled:opacity-50 flex items-center gap-2 w-full sm:w-auto justify-center"
    >
      {label}
      {isSubmitting ? (
        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <Send className="w-4 h-4" />
      )}
    </button>
  </div>
);
