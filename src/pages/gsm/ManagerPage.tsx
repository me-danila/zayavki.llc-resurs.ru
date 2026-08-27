// Лэйаут менеджера/админа: хедер с вкладками разделов + текущая страница.
// Контракт пропсов прежний: { user; onLoggedOut }.
//
// Раньше всё жило одной страницей со сворачиваемыми секциями; теперь каждый раздел —
// отдельный маршрут (мини-роутер src/lib/router.ts), а внутри страницы контент виден
// сразу, без тогглов:
//   /gsm            — приход ГСМ
//   /gsm/stock      — остатки по участкам (+ модалка перемещения)
//   /gsm/sites      — участки             (право sites.manage)
//   /gsm/staff      — сотрудники          (право users.manage)
//   /gsm/parts      — расход материалов
//   /gsm/initiators — инициаторы заявки   (право initiators.manage)
// Страница механика (EmployeePage) не менялась.
//
// Общие данные (активные участки, партии) грузим здесь и раздаём страницам: они нужны
// нескольким разделам сразу, а перезапрос на каждый переход был бы лишним.

import React from 'react';
import type { User, Lot, Site } from '../../lib/gsmTypes';
import * as api from '../../lib/gsmApi';
import { useRoute } from '../../lib/router';
import GsmHeader from '../../components/gsm/GsmHeader';
import GsmNav from '../../components/gsm/GsmNav';
import { visibleNavItems } from '../../lib/gsmNav';
import ReceiptPage from './manager/ReceiptPage';
import StockPage from './manager/StockPage';
import SitesPage from './manager/SitesPage';
import StaffPage from './manager/StaffPage';
import InitiatorsPage from './manager/InitiatorsPage';
import PartsPage from './manager/PartsPage';

export interface ManagerPageProps {
  user: User;
  onLoggedOut: () => void;
}

const ManagerPage: React.FC<ManagerPageProps> = ({ user, onLoggedOut }) => {
  const path = useRoute();
  const [lots, setLots] = React.useState<Lot[] | null>(null);
  const [lotsError, setLotsError] = React.useState(false);
  // Активные участки в области видимости — опции форм прихода/сотрудников и галочки доступов.
  const [activeSites, setActiveSites] = React.useState<Site[]>([]);
  // Участки-ЦЕЛИ перемещения — отдельный список: он шире области видимости
  // (цель перемещения по определению чужой участок), см. /sites/transfer-targets.
  const [transferTargets, setTransferTargets] = React.useState<Site[]>([]);

  // refetch-функции для обновления после действий пользователя.
  const loadLots = React.useCallback(async () => {
    try {
      setLots(await api.getLots());
      setLotsError(false);
    } catch {
      setLotsError(true);
    }
  }, []);

  const loadSites = React.useCallback(async () => {
    try {
      const list = await api.getSites();
      setActiveSites(list.filter((s) => s.active));
    } catch {
      // молча — формы просто получат прежний список опций
    }
    try {
      setTransferTargets(await api.getTransferTargets());
    } catch {
      // молча — выпадашка целей останется с прежним списком
    }
  }, []);

  // Первичная загрузка: состояние меняем только в колбэках промисов, а не вызовом
  // loadLots/loadSites — иначе эффект дёргает setState синхронно
  // (react-hooks/set-state-in-effect). alive отсекает ответы после размонтирования.
  React.useEffect(() => {
    let alive = true;
    void api.getLots().then(
      (list) => {
        if (!alive) return;
        setLots(list);
        setLotsError(false);
      },
      () => {
        if (alive) setLotsError(true);
      },
    );
    void api.getSites().then(
      (list) => {
        if (alive) setActiveSites(list.filter((s) => s.active));
      },
      () => {
        // молча — формы просто получат пустой список опций
      },
    );
    void api.getTransferTargets().then(
      (list) => {
        if (alive) setTransferTargets(list);
      },
      () => {
        // молча — выпадашка целей просто останется пустой
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // Маршрут вне выданных прав (например, право отозвали при открытой вкладке)
  // показываем как приход — вместо пустого экрана.
  const allowed = React.useMemo(
    () => new Set(visibleNavItems(user).map((i) => i.href)),
    [user],
  );
  const route = allowed.has(path) ? path : '/gsm';

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans">
      <GsmHeader
        user={user}
        onLogout={onLoggedOut}
        nav={<GsmNav user={user} path={route} />}
      />

      <div className="max-w-7xl mx-auto space-y-6 py-4 px-4 sm:py-8 sm:px-6 lg:px-8">
        {route === '/gsm' && <ReceiptPage sites={activeSites} onSaved={loadLots} />}
        {route === '/gsm/stock' && (
          <StockPage
            lots={lots}
            lotsError={lotsError}
            transferSites={transferTargets}
            onChanged={loadLots}
          />
        )}
        {route === '/gsm/sites' && <SitesPage onChanged={loadSites} />}
        {route === '/gsm/staff' && <StaffPage user={user} sites={activeSites} />}
        {route === '/gsm/parts' && <PartsPage sites={activeSites} />}
        {route === '/gsm/initiators' && <InitiatorsPage />}
      </div>
    </div>
  );
};

export default ManagerPage;
