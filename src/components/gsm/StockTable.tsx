// Остатки — data table в духе shadcn на чистом Tailwind (desktop) / карточки (мобилка).
// Общий для менеджера и механика (scope). Toolbar: поиск по name+code, вкладки
// Активные/Закончившиеся/Все; фильтр по участкам — только у менеджера (у механика
// один участок). Группировка по участкам — только у менеджера. `…`-меню строки:
//  • manager: «История» + «Переместить»; правка/отмена прихода и списаний — через
//    `…`-меню СОБЫТИЙ в истории (LotHistory scope='manager').
//  • worker:  «Списать» + «Переместить» + «История» (история read-only).
// Списание/перемещение открываются модалками у родителя. onChanged() — рефетч lots.

import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  ArrowRightLeft,
  ChevronDown,
  History as HistoryIcon,
  MapPin,
  MinusCircle,
  PackageOpen,
  Search,
} from 'lucide-react';
import type { Lot } from '../../lib/gsmTypes';
import { EPS } from '../../lib/gsmSchemas';
import LotHistory from './LotHistory';
import DotsMenu from './DotsMenu';
import { formatRu } from '../../lib/gsmDates';

export interface StockTableProps {
  lots: Lot[];
  // 'manager' — группировка+фильтр по участкам, правка в истории; 'worker' — плоский
  // список одного участка, действие «Списать», история read-only.
  scope: 'manager' | 'worker';
  // «Переместить» из `…`-меню (родитель открывает TransferForm модалкой).
  onTransfer: (lot: Lot) => void;
  // «Списать» из `…`-меню (worker; родитель открывает WriteOffForm модалкой).
  onWriteOff?: (lot: Lot) => void;
  // Перезагрузка lots после отмены/правки прихода или списания в истории.
  onChanged: () => void;
}

type Tab = 'active' | 'ended' | 'all';

const isActive = (lot: Lot): boolean => lot.balance > EPS;

const authorName = (a: Lot['author']): string => a.displayName || a.username;

// Кол-во без хвостовых нулей: 12.500 → 12.5.
const fmtQty = (n: number): string => String(Math.round(n * 1000) / 1000);

// --- Пустое состояние (нет партий вообще) ---

const EmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 bg-white py-10 text-gray-400">
    <PackageOpen className="h-7 w-7" />
    <p className="text-sm font-bold uppercase tracking-wide">Нет товаров</p>
  </div>
);

// --- Фильтр по участкам (Popover с чекбоксами) ---

interface SiteFilterProps {
  siteNames: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

const SiteFilter: React.FC<SiteFilterProps> = ({
  siteNames,
  selected,
  onChange,
}) => {
  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-gray-700 transition-all hover:bg-gray-50"
        >
          <MapPin className="h-4 w-4 text-gray-400" />
          Участки
          {selected.size > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-gray-900 px-1 text-[10px] font-bold text-white">
              {selected.size}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-60 rounded-lg border border-gray-200 bg-white p-1 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          {siteNames.map((name) => (
            <label
              key={name}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selected.has(name)}
                onChange={() => toggle(name)}
                className="accent-gray-900"
              />
              <span className="min-w-0 truncate">{name}</span>
            </label>
          ))}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="mt-1 flex w-full items-center justify-center rounded-md border-t border-gray-100 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400 transition-colors hover:text-gray-700"
            >
              Сбросить
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

// --- Корневой компонент ---

const COLS = 5; // Наименование · Приход · Автор · Остаток · действия

const StockTable: React.FC<StockTableProps> = ({
  lots,
  scope,
  onTransfer,
  onWriteOff,
  onChanged,
}) => {
  const showGroups = scope === 'manager';
  const [search, setSearch] = React.useState('');
  const [tab, setTab] = React.useState<Tab>('active');
  const [selectedSites, setSelectedSites] = React.useState<Set<string>>(
    () => new Set()
  );
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  // Раскрытая inline-история (одна за раз).
  const [historyId, setHistoryId] = React.useState<number | null>(null);
  // Ширина видимой области таблицы: панель истории закрепляем по левому краю
  // (sticky) на эту ширину, чтобы её события и `…` не уезжали за горизонт.
  // Callback-ref, а не useEffect: таблица рендерится асинхронно (после загрузки
  // lots), эффект с [] на маунте не увидел бы ещё не смонтированный контейнер.
  const roRef = React.useRef<ResizeObserver | null>(null);
  const [viewW, setViewW] = React.useState<number | null>(null);
  const setScrollEl = React.useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      setViewW(el.clientWidth);
      const ro = new ResizeObserver(() => setViewW(el.clientWidth));
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);

  // Участки — из данных lots, по алфавиту (ru-locale, без учёта регистра).
  const siteOrder = React.useMemo(() => {
    const seen = new Set<string>();
    for (const lot of lots) seen.add(lot.siteName);
    return [...seen].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [lots]);

  // Поиск + фильтр участков (счётчики вкладок считаем от этого набора).
  const base = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return lots.filter((lot) => {
      if (selectedSites.size > 0 && !selectedSites.has(lot.siteName))
        return false;
      if (!q) return true;
      return (
        lot.name.toLowerCase().includes(q) || lot.code.toLowerCase().includes(q)
      );
    });
  }, [lots, search, selectedSites]);

  const counts = React.useMemo(() => {
    const active = base.filter(isActive).length;
    return { active, ended: base.length - active, all: base.length };
  }, [base]);

  const visible = React.useMemo(() => {
    if (tab === 'active') return base.filter(isActive);
    if (tab === 'ended') return base.filter((l) => !isActive(l));
    return base;
  }, [base, tab]);

  // Группировка видимых строк по участкам (пустые группы скрываем).
  const groups = React.useMemo(() => {
    const bySite = new Map<string, Lot[]>();
    for (const lot of visible) {
      const bucket = bySite.get(lot.siteName);
      if (bucket) bucket.push(lot);
      else bySite.set(lot.siteName, [lot]);
    }
    // Строки внутри участка — по наименованию (ru-locale), тай-брейк по коду.
    const byName = (a: Lot, b: Lot) =>
      a.name.localeCompare(b.name, 'ru') || a.code.localeCompare(b.code, 'ru');
    return siteOrder
      .filter((site) => bySite.has(site))
      .map((site) => ({
        site,
        rows: (bySite.get(site) as Lot[]).slice().sort(byName),
      }));
  }, [visible, siteOrder]);

  const toggleGroup = (site: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(site)) next.delete(site);
      else next.add(site);
      return next;
    });
  };

  const toggleHistory = (lotId: number) => {
    setHistoryId((prev) => (prev === lotId ? null : lotId));
  };

  if (lots.length === 0) return <EmptyState />;

  // Пункты `…`-меню строки/карточки (общие для таблицы и мобильных карточек).
  // worker: «Списать» первым (главное действие); затем «Переместить»; «История».
  const menuItems = (lot: Lot, active: boolean) => [
    ...(scope === 'worker' && active && onWriteOff
      ? [
          {
            key: 'writeoff',
            label: 'Списать',
            icon: <MinusCircle className="h-4 w-4" />,
            onSelect: () => onWriteOff(lot),
          },
        ]
      : []),
    ...(active
      ? [
          {
            key: 'transfer',
            label: 'Переместить',
            icon: <ArrowRightLeft className="h-4 w-4" />,
            onSelect: () => onTransfer(lot),
          },
        ]
      : []),
    {
      key: 'history',
      label: 'История',
      icon: <HistoryIcon className="h-4 w-4" />,
      onSelect: () => toggleHistory(lot.id),
    },
  ];

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'active', label: 'Активные', count: counts.active },
    { key: 'ended', label: 'Закончившиеся', count: counts.ended },
    { key: 'all', label: 'Все', count: counts.all },
  ];

  return (
    <div className="space-y-3">
      {/* Toolbar: поиск · вкладки · фильтр участков */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или коду…"
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-primary-resource focus:ring-2 focus:ring-primary-resource/20"
          />
        </div>

        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all ${
                tab === t.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-400 hover:text-gray-700'
              }`}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {showGroups && (
          <SiteFilter
            siteNames={siteOrder}
            selected={selectedSites}
            onChange={setSelectedSites}
          />
        )}
      </div>

      {/* Таблица — только на десктопе (sm+). На мобилке ниже — карточки. */}
      <div
        ref={setScrollEl}
        className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white sm:block"
      >
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Наименование
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Приход
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Автор
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Остаток
              </th>
              <th className="w-12 px-4 py-2.5" aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td
                  colSpan={COLS}
                  className="px-4 py-8 text-center text-xs font-bold uppercase tracking-wide text-gray-400"
                >
                  Ничего не найдено
                </td>
              </tr>
            )}
            {groups.map(({ site, rows }) => {
              const isCollapsed = collapsed.has(site);
              const activeCount = rows.filter(isActive).length;
              return (
                <React.Fragment key={site}>
                  {/* Строка-заголовок группы участка — только у менеджера */}
                  {showGroups && (
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <td colSpan={COLS} className="p-0">
                        <button
                          type="button"
                          onClick={() => toggleGroup(site)}
                          aria-expanded={!isCollapsed}
                          className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-gray-100"
                        >
                          <span className="flex items-center gap-2">
                            <ChevronDown
                              className={`h-4 w-4 text-gray-400 transition-transform ${
                                isCollapsed ? '-rotate-90' : ''
                              }`}
                            />
                            <span className="text-xs font-bold uppercase tracking-wide text-gray-700">
                              {site}
                            </span>
                          </span>
                          <span className="text-[11px] text-gray-400">
                            активных: {activeCount} из {rows.length}
                          </span>
                        </button>
                      </td>
                    </tr>
                  )}
                  {!isCollapsed &&
                    rows.map((lot) => {
                      const active = isActive(lot);
                      const expanded = historyId === lot.id;
                      return (
                        <React.Fragment key={lot.id}>
                          <tr
                            className={`transition-colors hover:bg-gray-50 ${
                              expanded ? '' : 'border-b border-gray-100'
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="font-bold text-gray-900">
                                {lot.name}
                              </div>
                              <div className="text-xs text-gray-400">
                                код {lot.code}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                              {formatRu(lot.receivedDate)}
                            </td>
                            <td className="px-4 py-3 text-gray-500">
                              {authorName(lot.author)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right">
                              <span
                                className={`font-bold ${
                                  active ? 'text-gray-900' : 'text-gray-400'
                                }`}
                              >
                                {fmtQty(lot.balance)}
                              </span>{' '}
                              <span className="text-xs text-gray-400">
                                {lot.unit}
                              </span>
                            </td>
                            <td className="px-2 py-3 text-right">
                              <DotsMenu items={menuItems(lot, active)} />
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="border-b border-gray-100">
                              <td colSpan={COLS} className="p-0">
                                {/* Панель истории закреплена по левому краю видимой
                                    области таблицы (inline position:sticky — не полагаемся
                                    на JIT-класс) и ограничена её шириной, чтобы события и
                                    их `…` не уезжали за горизонтальный скролл. */}
                                <div
                                  className="px-4 pb-4 pt-0"
                                  style={{
                                    position: 'sticky',
                                    left: 0,
                                    width: viewW ?? undefined,
                                  }}
                                >
                                  <LotHistory
                                    lotId={lot.id}
                                    unit={lot.unit}
                                    scope={scope}
                                    onChanged={onChanged}
                                  />
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Мобилка (< sm): карточки вместо таблицы — без горизонтального скролла. */}
      <div className="space-y-4 sm:hidden">
        {groups.length === 0 && (
          <p className="rounded-lg border border-dashed border-gray-200 bg-white py-8 text-center text-xs font-bold uppercase tracking-wide text-gray-400">
            Ничего не найдено
          </p>
        )}
        {groups.map(({ site, rows }) => {
          const isCollapsed = collapsed.has(site);
          const activeCount = rows.filter(isActive).length;
          return (
            <div key={site} className="space-y-2">
              {/* Заголовок группы участка — только у менеджера */}
              {showGroups && (
                <button
                  type="button"
                  onClick={() => toggleGroup(site)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-left"
                >
                  <span className="flex items-center gap-2">
                    <ChevronDown
                      className={`h-4 w-4 text-gray-400 transition-transform ${
                        isCollapsed ? '-rotate-90' : ''
                      }`}
                    />
                    <span className="text-xs font-bold uppercase tracking-wide text-gray-700">
                      {site}
                    </span>
                  </span>
                  <span className="text-[11px] text-gray-400">
                    активных: {activeCount} из {rows.length}
                  </span>
                </button>
              )}

              {!isCollapsed &&
                rows.map((lot) => {
                  const active = isActive(lot);
                  const expanded = historyId === lot.id;
                  return (
                    <div
                      key={lot.id}
                      className={`rounded-lg border bg-white p-3 ${
                        active ? 'border-gray-200' : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-gray-900">
                            {lot.name}
                          </div>
                          <div className="text-xs text-gray-400">
                            код {lot.code}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="text-right">
                            <span
                              className={`font-bold ${
                                active ? 'text-gray-900' : 'text-gray-400'
                              }`}
                            >
                              {fmtQty(lot.balance)}
                            </span>{' '}
                            <span className="text-xs text-gray-400">
                              {lot.unit}
                            </span>
                          </div>
                          <DotsMenu items={menuItems(lot, active)} />
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
                        <span>Приход: {formatRu(lot.receivedDate)}</span>
                        <span>Автор: {authorName(lot.author)}</span>
                      </div>

                      {expanded && (
                        <LotHistory
                          lotId={lot.id}
                          unit={lot.unit}
                          scope={scope}
                          onChanged={onChanged}
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StockTable;
