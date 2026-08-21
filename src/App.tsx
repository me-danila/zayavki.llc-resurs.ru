import React from 'react';
import ZayavkaPage from './pages/ZayavkaPage';
import GsmCardPage from './pages/GsmCardPage';
import { useRoute } from './lib/router';

const App: React.FC = () => {
  // useRoute вместо чтения location напрямую: внутри /gsm работает клиентская
  // навигация по разделам (src/lib/router.ts), и корень должен на неё реагировать.
  const path = useRoute();

  // Все разделы ГСМ живут под /gsm/* — конкретный раздел выбирает ManagerPage.
  if (path === '/gsm' || path.startsWith('/gsm/')) {
    return <GsmCardPage />;
  }

  return <ZayavkaPage />;
};

export default App;
