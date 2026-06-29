// Список партий (общий для менеджера и сотрудника).
// active (balance>EPS) сверху; archive (balance<=EPS) — под катом «Закончившиеся (N)».
// scope='manager' — группировка по участкам (сворачиваемые блоки), участок виден.
// scope='worker' — без участка, у active-партий кнопка «Списать».
// «История» — раскрывающаяся inline-секция <LotHistory/> (канон §5/§7). Без редактирования.

import React from 'react';
import {
  ChevronDown,
  History as HistoryIcon,
  MinusCircle,
  PackageOpen,
} from 'lucide-react';
import type { Lot } from '../../lib/gsmTypes';
import { EPS } from '../../lib/gsmSchemas';
import LotHistory from './LotHistory';

export interface StockListProps {
  lots: Lot[];
  scope: 'manager' | 'worker';
  onWriteOff?: (lot: Lot) => void;
  onHistory: (lot: Lot) => void;
}

const isActive = (lot: Lot): boolean => lot.balance > EPS;

const authorName = (a: Lot['author']): string => a.displayName || a.username;

// Кол-во без хвостовых нулей: 12.500 → 12.5.
const fmtQty = (n: number): string => String(Math.round(n * 1000) / 1000);

// --- Карточка одной партии ---

interface LotCardProps {
  lot: Lot;
  scope: 'manager' | 'worker';
  showSite: boolean;
  expanded: boolean;
  onToggleHistory: () => void;
  onWriteOff?: (lot: Lot) => void;
}

const LotCard: React.FC<LotCardProps> = ({
  lot,
  scope,
  showSite,
  expanded,
  onToggleHistory,
  onWriteOff,
}) => {
  const active = isActive(lot);
  const canWriteOff = scope === 'worker' && active;

  return (
    <div
      className={`rounded-lg border p-4 transition-all ${
        active ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-bold text-gray-900">{lot.name}</span>
            <span className="text-xs text-gray-400">код {lot.code}</span>
          </div>

          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
            <span>Приход: {lot.receivedDate}</span>
            <span>Автор: {authorName(lot.author)}</span>
            {showSite && <span>Участок: {lot.siteName}</span>}
          </div>
        </div>

        <div className="text-right">
          <div
            className={`text-lg font-bold ${
              active ? 'text-gray-900' : 'text-gray-400'
            }`}
          >
            {fmtQty(lot.balance)}{' '}
            <span className="text-xs font-normal text-gray-400">{lot.unit}</span>
          </div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400">
            остаток
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {canWriteOff && (
          <button
            type="button"
            onClick={() => onWriteOff?.(lot)}
            className="flex items-center gap-1.5 rounded-lg bg-resource-primary px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-900 transition-all hover:brightness-95"
          >
            <MinusCircle className="h-4 w-4" />
            Списать
          </button>
        )}
        <button
          type="button"
          onClick={onToggleHistory}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-700 transition-all hover:bg-gray-50"
        >
          <HistoryIcon className="h-4 w-4" />
          История
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      {expanded && <LotHistory lotId={lot.id} unit={lot.unit} />}
    </div>
  );
};

// --- Хук: какой партии раскрыта история (одна за раз) ---

function useExpanded(onHistory: (lot: Lot) => void) {
  const [openId, setOpenId] = React.useState<number | null>(null);
  const toggle = (lot: Lot) => {
    setOpenId((prev) => {
      const next = prev === lot.id ? null : lot.id;
      if (next !== null) onHistory(lot);
      return next;
    });
  };
  return { openId, toggle };
}

// --- Пустое состояние ---

const EmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 bg-white py-10 text-gray-400">
    <PackageOpen className="h-7 w-7" />
    <p className="text-sm font-bold uppercase tracking-wide">Нет товаров</p>
  </div>
);

// --- Сворачиваемая секция архива «Закончившиеся (N)» ---

interface ArchiveSectionProps {
  lots: Lot[];
  scope: 'manager' | 'worker';
  showSite: boolean;
  openId: number | null;
  onToggleHistory: (lot: Lot) => void;
  onWriteOff?: (lot: Lot) => void;
}

const ArchiveSection: React.FC<ArchiveSectionProps> = ({
  lots,
  scope,
  showSite,
  openId,
  onToggleHistory,
  onWriteOff,
}) => {
  const [open, setOpen] = React.useState(false);
  if (lots.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-2 text-xs font-bold uppercase tracking-wide text-gray-400 transition-colors hover:text-gray-600"
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
        Закончившиеся ({lots.length})
      </button>
      {open && (
        <div className="space-y-3 pt-1">
          {lots.map((lot) => (
            <LotCard
              key={lot.id}
              lot={lot}
              scope={scope}
              showSite={showSite}
              expanded={openId === lot.id}
              onToggleHistory={() => onToggleHistory(lot)}
              onWriteOff={onWriteOff}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- Плоский список партий (active сверху + архив под катом) ---

interface FlatListProps {
  lots: Lot[];
  scope: 'manager' | 'worker';
  showSite: boolean;
  openId: number | null;
  onToggleHistory: (lot: Lot) => void;
  onWriteOff?: (lot: Lot) => void;
}

const FlatList: React.FC<FlatListProps> = ({
  lots,
  scope,
  showSite,
  openId,
  onToggleHistory,
  onWriteOff,
}) => {
  const active = lots.filter(isActive);
  const archive = lots.filter((l) => !isActive(l));

  return (
    <div className="space-y-3">
      {active.map((lot) => (
        <LotCard
          key={lot.id}
          lot={lot}
          scope={scope}
          showSite={showSite}
          expanded={openId === lot.id}
          onToggleHistory={() => onToggleHistory(lot)}
          onWriteOff={onWriteOff}
        />
      ))}
      <ArchiveSection
        lots={archive}
        scope={scope}
        showSite={showSite}
        openId={openId}
        onToggleHistory={onToggleHistory}
        onWriteOff={onWriteOff}
      />
    </div>
  );
};

// --- Сворачиваемый блок одного участка (только для менеджера) ---

interface SiteGroupProps {
  site: string;
  lots: Lot[];
  openId: number | null;
  onToggleHistory: (lot: Lot) => void;
}

const SiteGroup: React.FC<SiteGroupProps> = ({
  site,
  lots,
  openId,
  onToggleHistory,
}) => {
  const [open, setOpen] = React.useState(true);
  const activeCount = lots.filter(isActive).length;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <ChevronDown
            className={`h-4 w-4 text-gray-400 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
          <span className="text-sm font-bold uppercase tracking-wide text-gray-700">
            {site}
          </span>
        </span>
        <span className="text-[11px] text-gray-400">
          активных: {activeCount} из {lots.length}
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100 p-3">
          <FlatList
            lots={lots}
            scope="manager"
            showSite={false}
            openId={openId}
            onToggleHistory={onToggleHistory}
          />
        </div>
      )}
    </div>
  );
};

// --- Корневой компонент ---

const StockList: React.FC<StockListProps> = ({
  lots,
  scope,
  onWriteOff,
  onHistory,
}) => {
  const { openId, toggle } = useExpanded(onHistory);

  if (lots.length === 0) return <EmptyState />;

  if (scope === 'manager') {
    // Группировка по участкам с сохранением порядка появления.
    const order: string[] = [];
    const bySite = new Map<string, Lot[]>();
    for (const lot of lots) {
      let bucket = bySite.get(lot.siteName);
      if (!bucket) {
        bucket = [];
        bySite.set(lot.siteName, bucket);
        order.push(lot.siteName);
      }
      bucket.push(lot);
    }

    return (
      <div className="space-y-4">
        {order.map((site) => (
          <SiteGroup
            key={site}
            site={site}
            lots={bySite.get(site) as Lot[]}
            openId={openId}
            onToggleHistory={toggle}
          />
        ))}
      </div>
    );
  }

  // scope === 'worker' — плоский список своего участка.
  return (
    <FlatList
      lots={lots}
      scope="worker"
      showSite={false}
      openId={openId}
      onToggleHistory={toggle}
      onWriteOff={onWriteOff}
    />
  );
};

export default StockList;
