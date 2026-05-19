import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
      <h2 style={{ marginTop: 0 }}>{t('notFound.title')}</h2>
      <p style={{ color: 'var(--muted-color, #666)' }}>{t('notFound.subtitle')}</p>
      <Link
        to="/now"
        className="btn-primary"
        style={{ display: 'inline-block', marginTop: '1rem', padding: '8px 16px' }}
      >
        {t('notFound.backToNow')}
      </Link>
    </div>
  );
}
