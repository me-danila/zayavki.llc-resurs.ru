// Страница СОТРУДНИКА участка. Две вкладки в хедере: «ГСМ» (остатки, списание,
// перемещение — как было) и «Материалы» (расход штучных материалов, v6).
// Маршрут выбирает мини-роутер, как у менеджера; всё остальное не менялось.
//
// Воркер видит только свой участок (бэк фильтрует /lots
// по session.siteId). Остатки — тот же StockTable, что у менеджера (scope='worker'):
// таблица на десктопе / карточки на мобилке, поиск, вкладки; без группировки и фильтра
// по участкам (участок один). `…`-меню строки: «Списать» / «Переместить» / «История»
// (история read-only). Списание (WriteOffForm) и перемещение (TransferForm) — в модалках.

import React from 'react';
import { Loader2 } from 'lucide-react';
import GsmHeader from '../../components/gsm/GsmHeader';
import GsmNav from '../../components/gsm/GsmNav';
import PartIssueForm from '../../components/gsm/PartIssueForm';
import PartIssuesList from '../../components/gsm/PartIssuesList';
import { useRoute } from '../../lib/router';
import StockTable from '../../components/gsm/StockTable';
import WriteOffForm from '../../components/gsm/WriteOffForm';
import TransferForm from '../../components/gsm/TransferForm';
import Modal from '../../components/gsm/Modal';
import { getLots, getActiveSites } from '../../lib/gsmApi';
import type { Lot, Site, User } from '../../lib/gsmTypes';

export interface EmployeePageProps {
  user: User;
  onLoggedOut: () => void;
}

const EmployeePage: React.FC<EmployeePageProps> = ({ user, onLoggedOut }) => {
  const path = useRoute();
  const route = path === '/gsm/parts' ? '/gsm/parts' : '/gsm';
  // Счётчик перезагрузки списка расхода после сохранения новой серии.
  const [partsVersion, setPartsVersion] = React.useState(0);
  const [lots, setLots] = React.useState<Lot[] | null>(null);
  const [error, setError] = React.useState(false);
  // Партия, выбранная для списания / перемещения (открывает соответствующую модалку).
  const [selectedLot, setSelectedLot] = React.useState<Lot | null>(null);
  const [transferLot, setTransferLot] = React.useState<Lot | null>(null);
  // Активные участки — опции целевого участка перемещения (воркеру доступно /sites/active).
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

  // Рефетч на mount (setState только в .then/.catch, с alive-флагом).
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

  // После сохранения серии списаний — закрыть модалку и обновить остатки.
  const handleSaved = React.useCallback(async () => {
    setSelectedLot(null);
    await loadLots();
  }, [loadLots]);

  // После успешного перемещения — закрыть модалку и обновить остатки.
  const handleTransferDone = React.useCallback(async () => {
    setTransferLot(null);
    await loadLots();
  }, [loadLots]);

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans">
      <GsmHeader
        user={user}
        onLogout={onLoggedOut}
        nav={<GsmNav user={user} path={route} />}
      />

      <div className="max-w-5xl mx-auto space-y-6 py-4 px-4 sm:py-8 sm:px-6 lg:px-8">
        {route === '/gsm/parts' ? (
          <div className="space-y-6">
            <PartIssueForm onSaved={() => setPartsVersion((v) => v + 1)} />
            <PartIssuesList reloadKey={partsVersion} />
          </div>
        ) : lots === null ? (
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
        ) : (
          <StockTable
            lots={lots}
            scope="worker"
            onWriteOff={setSelectedLot}
            onTransfer={setTransferLot}
            onChanged={loadLots}
          />
        )}
      </div>

      {/* Модалка списания выбранной партии */}
      {selectedLot && (
        <Modal
          open
          onClose={() => setSelectedLot(null)}
          title={`Списание: ${selectedLot.name} (${selectedLot.code})`}
          wide
        >
          <WriteOffForm
            key={selectedLot.id}
            lot={selectedLot}
            onSaved={handleSaved}
            onCancel={() => setSelectedLot(null)}
            frameless
          />
        </Modal>
      )}

      {/* Модалка перемещения выбранной партии */}
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
            sites={activeSites}
            onDone={handleTransferDone}
            onCancel={() => setTransferLot(null)}
            frameless
          />
        </Modal>
      )}
    </div>
  );
};

export default EmployeePage;
