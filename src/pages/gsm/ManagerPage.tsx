// Страница менеджера (дизайн-правки этого раунда). Контракт пропсов: { user; onLoggedOut }.
// Единый <GsmHeader/> (без «УЧЁТ ГСМ» и даты). Секции:
// (1) приход (ReceiptForm) — видим всегда; (2) «Остатки по участкам» — в CollapsibleSection
// (StockList scope='manager'); (3) «Сотрудники участков» — в CollapsibleSection с кнопкой-плюс
// в заголовке, раскрывающей форму нового сотрудника внутри EmployeeAdmin (showForm).
// Данные lots — на mount и после прихода. Главную (AppHeader) не трогаем.

import React from 'react';
import { Loader2, UserPlus, Plus } from 'lucide-react';
import type { User, Lot, Site } from '../../lib/gsmTypes';
import * as api from '../../lib/gsmApi';
import GsmHeader from '../../components/gsm/GsmHeader';
import CollapsibleSection from '../../components/gsm/CollapsibleSection';
import ReceiptForm from '../../components/gsm/ReceiptForm';
import StockList from '../../components/gsm/StockList';
import TransferForm from '../../components/gsm/TransferForm';
import EmployeeAdmin from '../../components/gsm/EmployeeAdmin';
import SiteAdmin from '../../components/gsm/SiteAdmin';

export interface ManagerPageProps {
  user: User;
  onLoggedOut: () => void;
}

const ManagerPage: React.FC<ManagerPageProps> = ({ user, onLoggedOut }) => {
  const [lots, setLots] = React.useState<Lot[] | null>(null);
  const [lotsError, setLotsError] = React.useState(false);
  const [showEmployeeForm, setShowEmployeeForm] = React.useState(false);
  const [employeesOpen, setEmployeesOpen] = React.useState(false);
  const [sitesOpen, setSitesOpen] = React.useState(false);
  const [showSiteForm, setShowSiteForm] = React.useState(false);
  // Активные участки — опции для форм прихода и сотрудника. SiteAdmin сам ведёт
  // полный список (включая архив); сюда подгружаем только активные.
  const [activeSites, setActiveSites] = React.useState<Site[]>([]);
  // Партия, выбранная для перемещения (открывает TransferForm).
  const [transferLot, setTransferLot] = React.useState<Lot | null>(null);

  const loadLots = React.useCallback(async () => {
    setLotsError(false);
    try {
      const list = await api.getLots();
      setLots(list);
    } catch {
      setLotsError(true);
    }
  }, []);

  // Перезагрузка активных участков (после create/archive/restore в SiteAdmin).
  const loadSites = React.useCallback(async () => {
    try {
      const list = await api.getSites();
      setActiveSites(list.filter((s) => s.active));
    } catch {
      // молча — формы просто получат пустой/прежний список опций
    }
  }, []);

  React.useEffect(() => {
    void loadLots();
    void loadSites();
  }, [loadLots, loadSites]);

  // После успешного перемещения — закрыть форму и обновить остатки.
  const handleTransferDone = React.useCallback(async () => {
    setTransferLot(null);
    await loadLots();
  }, [loadLots]);

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans">
      <GsmHeader user={user} onLogout={onLoggedOut} />

      <div className="max-w-5xl mx-auto space-y-6 py-4 px-4 sm:py-8 sm:px-6 lg:px-8">
        {/* 1. Приход — всегда видим */}
        <section>
          <ReceiptForm onSaved={loadLots} sites={activeSites} />
        </section>

        {/* 2. Остатки по участкам — сворачиваемая секция */}
        <CollapsibleSection title="Остатки по участкам" defaultOpen={false}>
          {lots === null && !lotsError && (
            <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Загрузка остатков…
            </div>
          )}
          {lotsError && (
            <p className="py-2 text-xs text-red-500">Не удалось загрузить остатки.</p>
          )}
          {/* Форма перемещения выбранной партии (любой участок — менеджер). */}
          {transferLot && (
            <div className="mb-4">
              <TransferForm
                key={transferLot.id}
                lot={transferLot}
                sites={activeSites}
                onDone={handleTransferDone}
                onCancel={() => setTransferLot(null)}
              />
            </div>
          )}
          {lots !== null && !lotsError && (
            <StockList
              lots={lots}
              scope="manager"
              onTransfer={setTransferLot}
              onHistory={() => {}}
            />
          )}
        </CollapsibleSection>

        {/* 3. Участки — сворачиваемая секция с кнопкой-плюс (раскрывает секцию) */}
        <CollapsibleSection
          title="Участки"
          open={sitesOpen}
          onOpenChange={setSitesOpen}
          right={
            <button
              type="button"
              onClick={() => {
                const next = !showSiteForm;
                setShowSiteForm(next);
                // открытие формы добавления должно и раскрыть секцию
                if (next) setSitesOpen(true);
              }}
              aria-pressed={showSiteForm}
              title={showSiteForm ? 'Скрыть форму' : 'Добавить участок'}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                showSiteForm
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-900'
              }`}
            >
              <Plus className="w-4 h-4" />
            </button>
          }
        >
          <SiteAdmin onChanged={loadSites} showForm={showSiteForm} />
        </CollapsibleSection>

        {/* 4. Сотрудники участков — сворачиваемая секция с кнопкой-плюс */}
        <CollapsibleSection
          title="Сотрудники участков"
          open={employeesOpen}
          onOpenChange={setEmployeesOpen}
          right={
            <button
              type="button"
              onClick={() => {
                const next = !showEmployeeForm;
                setShowEmployeeForm(next);
                // открытие формы должно и раскрыть секцию (иначе форма не видна)
                if (next) setEmployeesOpen(true);
              }}
              aria-pressed={showEmployeeForm}
              title={showEmployeeForm ? 'Скрыть форму' : 'Добавить сотрудника'}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                showEmployeeForm
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-900'
              }`}
            >
              <UserPlus className="w-4 h-4" />
            </button>
          }
        >
          <EmployeeAdmin showForm={showEmployeeForm} sites={activeSites} />
        </CollapsibleSection>
      </div>
    </div>
  );
};

export default ManagerPage;
