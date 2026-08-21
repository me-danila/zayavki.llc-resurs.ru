// Раздел «Сотрудники» (/gsm/staff, право users.manage).
// Две группы под одним переключателем: механики участков и менеджеры с доступами.
// Формы создания видны сразу — на отдельной странице прятать их за «+» незачем.

import React from 'react';
import type { Site, User } from '../../../lib/gsmTypes';
import EmployeeAdmin from '../../../components/gsm/EmployeeAdmin';
import UserAdmin from '../../../components/gsm/UserAdmin';
import PageHeading from './PageHeading';

export interface StaffPageProps {
  user: User;
  sites: Site[];
}

type Tab = 'workers' | 'managers';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'workers', label: 'Механики' },
  { key: 'managers', label: 'Менеджеры' },
];

const StaffPage: React.FC<StaffPageProps> = ({ user, sites }) => {
  const [tab, setTab] = React.useState<Tab>('workers');

  const description =
    tab === 'workers'
      ? 'Механики участков: создание, правка ФИО и участка, сброс пароля, архив.'
      : 'Менеджеры: создание, доступ к участкам и права на редактирование справочников.';

  return (
    <div className="space-y-4">
      <PageHeading
        title="Сотрудники"
        description={description}
        right={
          <div
            role="tablist"
            className="flex rounded-lg border border-gray-200 bg-white p-0.5"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors ${
                  tab === t.key
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'workers' ? (
        <EmployeeAdmin
          showForm
          sites={sites}
          canEditSite={user.permissions.includes('access.manage')}
        />
      ) : (
        <UserAdmin currentUser={user} sites={sites} showForm />
      )}
    </div>
  );
};

export default StaffPage;
