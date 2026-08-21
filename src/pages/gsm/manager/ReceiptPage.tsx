// Раздел «Приход» — стартовая страница менеджера/админа (/gsm).
// Форма прихода и раньше была видна сразу, поэтому здесь она без обёрток.

import React from 'react';
import type { Site } from '../../../lib/gsmTypes';
import ReceiptForm from '../../../components/gsm/ReceiptForm';

export interface ReceiptPageProps {
  sites: Site[];
  onSaved: () => void;
}

const ReceiptPage: React.FC<ReceiptPageProps> = ({ sites, onSaved }) => (
  <ReceiptForm onSaved={onSaved} sites={sites} />
);

export default ReceiptPage;
