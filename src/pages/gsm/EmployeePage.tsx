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
import { getLots } from '../../lib/gsmApi';
import type { Lot, User } from '../../lib/gsmTypes';

export interface EmployeePageProps {
  user: User;
  onLoggedOut: () => void;
}

const EmployeePage: React.FC<EmployeePageProps> = ({ user, onLoggedOut }) => {
  const [lots, setLots] = React.useState<Lot[] | null>(null);
  const [error, setError] = React.useState(false);
  const [selectedLot, setSelectedLot] = React.useState<Lot | null>(null);

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

  // Открыть форму списания по выбранной партии.
  const handleWriteOff = (lot: Lot) => {
    setSelectedLot(lot);
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
            onHistory={handleHistory}
          />
        )}
      </div>
    </div>
  );
};

export default EmployeePage;
