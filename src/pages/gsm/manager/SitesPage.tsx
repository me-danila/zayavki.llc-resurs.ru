// Раздел «Участки» (/gsm/sites, право sites.manage).
// Форма создания больше не прячется за «+» — на отдельной странице она видна сразу.

import React from 'react';
import SiteAdmin from '../../../components/gsm/SiteAdmin';
import PageHeading from './PageHeading';

export interface SitesPageProps {
  // Перезагрузка активных участков в лэйауте после create/rename/archive/restore.
  onChanged: () => void;
}

const SitesPage: React.FC<SitesPageProps> = ({ onChanged }) => (
  <div className="space-y-4">
    <PageHeading
      title="Участки"
      description="Создание, переименование и архивирование. Архив обратим: участок можно вернуть."
    />
    <SiteAdmin onChanged={onChanged} showForm />
  </div>
);

export default SitesPage;
