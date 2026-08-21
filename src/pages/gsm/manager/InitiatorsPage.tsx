// Раздел «Инициаторы заявки» (/gsm/initiators, право initiators.manage).
// Справочник подставляется в форму заявки на «/».

import React from 'react';
import InitiatorAdmin from '../../../components/gsm/InitiatorAdmin';
import PageHeading from './PageHeading';

const InitiatorsPage: React.FC = () => (
  <div className="space-y-4">
    <PageHeading
      title="Инициаторы заявки"
      description="Список ФИО и должностей, который подставляется в форму заявки на главной странице."
    />
    <InitiatorAdmin showForm />
  </div>
);

export default InitiatorsPage;
