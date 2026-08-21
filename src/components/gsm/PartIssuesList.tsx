// Список расхода материалов, внесённого механиком (его участок, свежие сверху).
// Только чтение: править и отменять записи может лишь менеджер, поэтому действий нет.
// reloadKey меняется после сохранения новой серии — это и есть сигнал перезапросить.

import React from 'react';
import { Loader2 } from 'lucide-react';
import * as api from '../../lib/gsmApi';
import type { PartIssue } from '../../lib/gsmTypes';

export interface PartIssuesListProps {
  reloadKey: number;
}

const PartIssuesList: React.FC<PartIssuesListProps> = ({ reloadKey }) => {
  const [issues, setIssues] = React.useState<PartIssue[] | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    api.getPartIssues().then(
      (list) => {
        if (!alive) return;
        setIssues(list);
        setError(false);
      },
      () => {
        if (alive) setError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
          Внесённый расход
        </h2>
        <p className="mt-0.5 text-[11px] text-gray-400">
          Если ошиблись — сообщите менеджеру, правки делает он.
        </p>
      </div>

      {issues === null && !error && (
        <div className="flex items-center gap-2 px-4 py-5 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Загрузка…
        </div>
      )}
      {error && (
        <p className="px-4 py-5 text-xs text-red-500">Не удалось загрузить список.</p>
      )}
      {issues !== null && issues.length === 0 && !error && (
        <p className="px-4 py-5 text-xs text-gray-400">Записей пока нет.</p>
      )}

      <div className="divide-y divide-gray-50">
        {issues?.map((i) => (
          <div
            key={i.id}
            className={`flex items-start justify-between gap-3 px-4 py-3 ${
              i.voided ? 'opacity-50' : ''
            }`}
          >
            <div className="min-w-0">
              <p
                className={`truncate text-sm font-bold text-gray-900 ${
                  i.voided ? 'line-through' : ''
                }`}
              >
                {i.name}
              </p>
              <p className="truncate text-[11px] text-gray-400">
                № {i.partNumber} · {i.licensePlate} · {i.recipient}
              </p>
              {i.comment && (
                <p className="truncate text-[11px] text-gray-500">
                  Комментарий: {i.comment}
                </p>
              )}
              {i.voided && (
                <p className="text-[11px] text-red-500">отменено менеджером</p>
              )}
              {i.correction?.action === 'edit' && (
                <p className="text-[11px] text-amber-600">исправлено менеджером</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div
                className={`text-sm font-bold ${
                  i.voided ? 'text-gray-400 line-through' : 'text-gray-900'
                }`}
              >
                {i.qty} шт
              </div>
              <div className="text-[11px] text-gray-400">{i.issueDate}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PartIssuesList;
