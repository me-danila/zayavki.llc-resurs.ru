// Хронология одной партии — раскрывающаяся секция (НЕ модалка, без новых зависимостей).
// На mount тянет getHistory(lotId): строка прихода (+qty, автор) и строки списаний
// (№ авто, −qty, остаток-после, причина, автор). Время не выводим (канон §3.2).

import React from 'react';
import {
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowRightLeft,
} from 'lucide-react';
import { getHistory } from '../../lib/gsmApi';
import type { HistoryEvent } from '../../lib/gsmTypes';

export interface LotHistoryProps {
  lotId: number;
  unit?: string;
}

const authorName = (a: HistoryEvent['author']): string =>
  a.displayName || a.username;

// Кол-во без хвостовых нулей: 12.500 → 12.5, 10.000 → 10.
const fmtQty = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return String(r);
};

const LotHistory: React.FC<LotHistoryProps> = ({ lotId, unit = 'л' }) => {
  const [events, setEvents] = React.useState<HistoryEvent[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    getHistory(lotId)
      .then((res) => {
        if (!alive) return;
        setEvents(res.events);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [lotId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Загрузка истории…
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-4 text-xs text-red-500">Не удалось загрузить историю.</p>
    );
  }

  if (!events || events.length === 0) {
    return <p className="py-4 text-xs text-gray-400">Событий нет.</p>;
  }

  return (
    <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3">
      {events.map((ev, i) => {
        const isIncoming = ev.kind === 'receipt' || ev.kind === 'transfer_in';
        const isTransfer =
          ev.kind === 'transfer_in' || ev.kind === 'transfer_out';
        // Подпись события (нижняя строка с автором).
        const label =
          ev.kind === 'receipt'
            ? 'Приход'
            : ev.kind === 'writeoff'
              ? 'Списание'
              : ev.kind === 'transfer_in'
                ? `Поступление ← ${ev.counterSiteName ?? '—'}`
                : `Перемещение → ${ev.counterSiteName ?? '—'}`;
        return (
          <li
            key={i}
            className="flex items-start gap-3 rounded-lg bg-gray-50 px-3 py-2"
          >
            <div
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                isIncoming
                  ? 'bg-resource-primary/20 text-gray-700'
                  : 'bg-gray-200 text-gray-600'
              }`}
            >
              {isTransfer ? (
                <ArrowRightLeft className="h-3.5 w-3.5" />
              ) : isIncoming ? (
                <ArrowDownToLine className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpFromLine className="h-3.5 w-3.5" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-xs font-bold text-gray-700">
                  {ev.date}
                </span>
                <span
                  className={`text-xs font-bold ${
                    isIncoming ? 'text-green-600' : 'text-red-500'
                  }`}
                >
                  {isIncoming ? '+' : '−'}
                  {fmtQty(ev.qty)} {unit}
                </span>
                {!isIncoming && (
                  <span className="text-[11px] text-gray-500">
                    остаток: {fmtQty(ev.balanceAfter)} {unit}
                  </span>
                )}
              </div>

              {ev.kind === 'writeoff' && (
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                  {ev.licensePlate && (
                    <span>
                      № авто: <span className="text-gray-700">{ev.licensePlate}</span>
                    </span>
                  )}
                  {ev.reason && (
                    <span>
                      причина: <span className="text-gray-700">{ev.reason}</span>
                    </span>
                  )}
                </div>
              )}

              <p className="mt-0.5 text-[11px] text-gray-400">
                {label} — {authorName(ev.author)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default LotHistory;
