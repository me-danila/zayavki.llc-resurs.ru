// Раздел «Материалы» (/gsm/parts) у менеджера — журнал расхода штучных материалов.
// К учёту ГСМ отношения не имеет: у этих записей нет прихода, партий и остатков.

import React from 'react';
import type { Site } from '../../../lib/gsmTypes';
import PartIssuesTable from '../../../components/gsm/PartIssuesTable';
import PageHeading from './PageHeading';

export interface PartsPageProps {
  sites: Site[];
}

const PartsPage: React.FC<PartsPageProps> = ({ sites }) => (
  <div className="space-y-4">
    <PageHeading
      title="Расход материалов"
      description="Штучные материалы, выданные механиками. Правка и отмена — в меню строки; выгрузка учитывает текущий фильтр."
    />
    <PartIssuesTable sites={sites} />
  </div>
);

export default PartsPage;
