// Заголовок раздела страницы: слева — название и пояснение,
// справа — опциональный слот действий.

import React from 'react';

export interface PageHeadingProps {
  title: string;
  description?: string;
  right?: React.ReactNode;
}

const PageHeading: React.FC<PageHeadingProps> = ({ title, description, right }) => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-sm font-bold uppercase tracking-wide text-gray-700">
        {title}
      </h1>
      {description && (
        <p className="mt-1 text-xs text-gray-400">{description}</p>
      )}
    </div>
    {right && <div className="shrink-0">{right}</div>}
  </div>
);

export default PageHeading;
