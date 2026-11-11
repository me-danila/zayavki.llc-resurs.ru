import React from 'react';
import { getSites, setWriteoffPolicy } from '../../../lib/gsmApi';
import type { Site } from '../../../lib/gsmTypes';
import PageHeading from './PageHeading';

const SettingsPage: React.FC = () => {
  const [sites, setSites] = React.useState<Site[] | null>(null);
  const [saving, setSaving] = React.useState<number[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    void getSites().then(
      (list) => {
        if (!alive) return;
        setSites(list);
        setError(null);
      },
      () => {
        if (alive) setError('Не удалось загрузить настройки.');
      },
    );
    return () => {
      alive = false;
    };
  }, [reload]);

  const save = async (site: Site, allowed: boolean) => {
    setSaving((ids) => [...ids, site.id]);
    setError(null);
    try {
      await setWriteoffPolicy(site.id, allowed);
      setSites((list) => list?.map((s) => (
        s.id === site.id ? { ...s, allowBackdatedWriteoffs: allowed } : s
      )) ?? null);
    } catch {
      setError(`Не удалось сохранить настройку участка «${site.name}».`);
    } finally {
      setSaving((ids) => ids.filter((id) => id !== site.id));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeading title="Настройки ГСМ" description="Правила списания для механиков ваших участков." />
      <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 space-y-4">
        <h2 className="font-bold text-gray-800">Списания задним числом</h2>
        <p className="text-sm text-gray-500">
          Разрешить механикам выбирать дату от даты прихода партии до сегодняшнего дня.
          Если выключено, списывать можно только сегодняшним числом по Москве.
          Настройка сохраняется сразу. Она применяется к списаниям ГСМ.
        </p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {sites === null ? (
          error ? (
            <button type="button" className="resource-button-secondary" onClick={() => setReload((n) => n + 1)}>
              Повторить
            </button>
          ) : <p className="text-sm text-gray-400">Загрузка…</p>
        ) : sites.length === 0 ? (
          <p className="text-sm text-gray-500">Нет доступных участков.</p>
        ) : sites.map((site) => (
          <label key={site.id} className="flex items-center gap-3 border-t border-gray-100 pt-4 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-resource-primary"
              checked={site.allowBackdatedWriteoffs}
              disabled={saving.includes(site.id)}
              onChange={(event) => void save(site, event.target.checked)}
            />
            <span>Разрешить списания задним числом — {site.name}{!site.active && ' (архив)'}</span>
            {saving.includes(site.id) && <span role="status" className="text-gray-400">Сохранение…</span>}
          </label>
        ))}
      </div>
    </div>
  );
};

export default SettingsPage;
