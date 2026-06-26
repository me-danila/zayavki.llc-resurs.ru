import React from 'react';
import ZayavkaPage from './pages/ZayavkaPage';
import GsmCardPage from './pages/GsmCardPage';

const App: React.FC = () => {
  const path = window.location.pathname.replace(/\/+$/, '');

  if (path === '/gsm-card') {
    return <GsmCardPage />;
  }

  return <ZayavkaPage />;
};

export default App;
