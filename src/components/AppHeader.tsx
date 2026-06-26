import React from 'react';

interface AppHeaderProps {
  title: string;
}

const today = () =>
  new Date().toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

export const AppHeader: React.FC<AppHeaderProps> = ({ title }) => (
  <header className="flex flex-row gap-2 mb-4 space-y-4 sm:items-center justify-between gap-4">
    <a href="/">
      <img src="/logo.svg" alt="logo" className="h-8" />
    </a>
    <div className="flex flex-col sm:items-end">
      <h1 className="text-xl font-bold text-gray-900 uppercase">{title}</h1>
      <p className="text-sm text-gray-500">{today()}</p>
    </div>
  </header>
);
