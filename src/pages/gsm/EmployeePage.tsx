// Страница СОТРУДНИКА участка (этап 6). Воркер видит только свой участок (бэк фильтрует
// /lots по session.siteId). StockList scope='worker' (active сверху, архив под катом) с
// кнопками «Списать»/«История». «Списать» → WriteOffForm по выбранной партии (selectedLot).
// После сохранения: закрыть форму, рефетч lots; можно выбрать другой товар (канон §6).
// История — inline-секция внутри StockList (<LotHistory/>).

import React from 'react';
import { Loader2 } from 'lucide-react';
import GsmHeader from '../../components/gsm/GsmHeader';
import StockList from '../../components/gsm/StockList';
import WriteOffForm from '../../components/gsm/WriteOffForm';
import TransferForm from '../../components/gsm/TransferForm';
import { getLots, getActiveSites } from '../../lib/gsmApi';
import type { Lot, Site, User } from '../../lib/gsmTypes';

export interface EmployeePageProps {
  user: User;
  onLoggedOut: () => void;
}

const EmployeePage: React.FC<EmployeePageProps> = ({ user, onLoggedOut }) => {
  const [lots, setLots] = React.useState<Lot[] | null>(null);
  const [error, setError] = React.useState(false);
  const [selectedLot, setSelectedLot] = React.useState<Lot | null>(null);
  // Партия, выбранная для перемещения (открывает TransferForm).
  const [transferLot, setTransferLot] = React.useState<Lot | null>(null);
  // Активные участки — опции целевого участка перемещения (доступно воркеру через /sites/active).
  const [activeSites, setActiveSites] = React.useState<Site[]>([]);

  const loadLots = React.useCallback(async () => {
    setError(false);
    try {
      const data = await getLots();
      setLots(data);
    } catch {
      setError(true);
      setLots([]);
    }
  }, []);

  // Рефетч на mount (паттерн LotHistory: setState только в .then/.catch, с alive-флагом).
  React.useEffect(() => {
    let alive = true;
    getLots()
      .then((data) => {
        if (alive) setLots(data);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLots([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Активные участки на mount (для выпадашки целевого участка перемещения).
  React.useEffect(() => {
    let alive = true;
    getActiveSites()
      .then((sites) => {
        if (alive) setActiveSites(sites);
      })
      .catch(() => {
        if (alive) setActiveSites([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Открыть форму списания по выбранной партии (перемещение — закрыть).
  const handleWriteOff = (lot: Lot) => {
    setTransferLot(null);
    setSelectedLot(lot);
  };

  // Открыть форму перемещения по выбранной партии (списание — закрыть).
  const handleTransfer = (lot: Lot) => {
    setSelectedLot(null);
    setTransferLot(lot);
  };

  // После успешного перемещения — закрыть форму и обновить остатки.
  const handleTransferDone = async () => {
    setTransferLot(null);
    await loadLots();
  };

  // История раскрывается внутри StockList; коллбек обязателен по контракту StockListProps.
  const handleHistory = () => {
    /* StockList сам рендерит inline-историю; здесь ничего не требуется */
  };

  // После сохранения серии — закрыть форму и обновить остатки (можно выбрать другой товар).
  const handleSaved = async () => {
    setSelectedLot(null);
    await loadLots();
  };

  const handleCancel = () => {
    setSelectedLot(null);
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] py-8 px-4 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        <GsmHeader user={user} onLogout={onLoggedOut} />

        {/* Форма списания выбранной партии */}
        {selectedLot && (
          <WriteOffForm
            key={selectedLot.id}
            lot={selectedLot}
            onSaved={handleSaved}
            onCancel={handleCancel}
          />
        )}

        {/* Форма перемещения выбранной партии */}
        {transferLot && (
          <TransferForm
            key={transferLot.id}
            lot={transferLot}
            sites={activeSites}
            onDone={handleTransferDone}
            onCancel={() => setTransferLot(null)}
          />
        )}

        {/* Список партий участка */}
        {lots === null ? (
          <div className="flex items-center gap-2 py-10 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Загрузка остатков…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white py-10 text-center">
            <p className="text-sm text-red-500">Не удалось загрузить остатки.</p>
            <button
              type="button"
              onClick={() => void loadLots()}
              className="mt-3 resource-button-secondary"
            >
              Повторить
            </button>
          </div>
        ) : lots.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 bg-white py-10 text-gray-400">
            <p className="text-sm font-bold uppercase tracking-wide">
              На вашем участке нет товаров
            </p>
          </div>
        ) : (
          <StockList
            lots={lots}
            scope="worker"
            onWriteOff={handleWriteOff}
            onTransfer={handleTransfer}
            onHistory={handleHistory}
          />
        )}
      </div>
    </div>
  );
};

export default EmployeePage;
