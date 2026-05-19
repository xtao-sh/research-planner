import React from 'react';
import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage || i18n.language || 'zh-CN').toLowerCase();
  const isZh = current.startsWith('zh');

  const baseStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid var(--border-color, #ddd)',
    borderRadius: 4,
    padding: '0.15rem 0.5rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
  };
  const activeStyle: React.CSSProperties = {
    ...baseStyle,
    fontWeight: 700,
    background: 'var(--bg-secondary, #eef1f5)',
  };

  return (
    <div
      role="group"
      aria-label={t('language.switchTo')}
      style={{ display: 'inline-flex', gap: '0.25rem' }}
    >
      <button
        type="button"
        onClick={() => i18n.changeLanguage('zh-CN')}
        style={isZh ? activeStyle : baseStyle}
        aria-pressed={isZh}
      >
        中
      </button>
      <button
        type="button"
        onClick={() => i18n.changeLanguage('en')}
        style={!isZh ? activeStyle : baseStyle}
        aria-pressed={!isZh}
      >
        EN
      </button>
    </div>
  );
}
