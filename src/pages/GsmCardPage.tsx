// Контейнер маршрута /gsm-card. Тонкий: по сессии решает что показать.
// loading → спиннер; нет пользователя → LoginPage; иначе по роли — ManagerPage / EmployeePage.
// ManagerPage/EmployeePage реализуются на этапе Roles; контракт пропсов: { user, onLoggedOut }.

import React from 'react';
import { useSession } from '../components/gsm/useSession';
import LoginPage from './gsm/LoginPage';
import ManagerPage from './gsm/ManagerPage';
import EmployeePage from './gsm/EmployeePage';

const GsmCardPage: React.FC = () => {
  const { user, loading, setUser, logout } = useSession();

  // Title страницы /gsm — «Карточка ГСМ» (главная / остаётся со своим title из index.html).
  React.useEffect(() => {
    document.title = 'Карточка ГСМ';
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center font-sans">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onAuthed={setUser} />;
  }

  if (user.role === 'manager') {
    return <ManagerPage user={user} onLoggedOut={logout} />;
  }

  return <EmployeePage user={user} onLoggedOut={logout} />;
};

export default GsmCardPage;
