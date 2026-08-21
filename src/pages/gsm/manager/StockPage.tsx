// Раздел «Остатки по участкам» (/gsm/stock).
// Таблица остатков видна сразу (раньше была свёрнута), перемещение партии — модалка.

import React from 'react';
import { Loader2 } from 'lucide-react';
import type { Lot, Site } from '../../../lib/gsmTypes';
import StockTable from '../../../components/gsm/StockTable';
import TransferForm from '../../../components/gsm/TransferForm';
import Modal from '../../../components/gsm/Modal';
import PageHeading from './PageHeading';

export interface StockPageProps {
  // null — данные ещё грузятся (лэйаут держит их для всех разделов).
  lots: Lot[] | null;
  lotsError: boolean;
  sites: Site[];
  onChanged: () => void | Promise<void>;
}

const StockPage: React.FC<StockPageProps> = ({
  lots,
  lotsError,
  sites,
  onChanged,
}) => {
  // Партия, выбранная для перемещения (открывает TransferForm в модалке).
  const [transferLot, setTransferLot] = React.useState<Lot | null>(null);

  const handleTransferDone = React.useCallback(async () => {
    setTransferLot(null);
    await onChanged();
  }, [onChanged]);

  return (
    <div className="space-y-4">
      <PageHeading
        title="Остатки по участкам"
        description="Партии в доступных вам участках. Правка, сторно и перемещение — в меню строки."
      />

      {lots === null && !lotsError && (
        <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Загрузка остатков…
        </div>
      )}
      {lotsError && (
        <p className="py-2 text-xs text-red-500">Не удалось загрузить остатки.</p>
      )}
      {lots !== null && !lotsError && (
        <StockTable
          lots={lots}
          scope="manager"
          onTransfer={setTransferLot}
          onChanged={onChanged}
        />
      )}

      {transferLot && (
        <Modal
          open
          onClose={() => setTransferLot(null)}
          title={`Перемещение: ${transferLot.name} (${transferLot.code})`}
          wide
        >
          <TransferForm
            key={transferLot.id}
            lot={transferLot}
            sites={sites}
            onDone={handleTransferDone}
            onCancel={() => setTransferLot(null)}
            frameless
          />
        </Modal>
      )}
    </div>
  );
};

export default StockPage;
