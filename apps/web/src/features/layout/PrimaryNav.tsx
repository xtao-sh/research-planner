import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function PrimaryNav() {
  const { t } = useTranslation();
  const items: Array<{ to: string; key: 'now' | 'inbox' | 'projects' }> = [
    { to: '/now', key: 'now' },
    { to: '/projects', key: 'projects' },
    { to: '/inbox', key: 'inbox' },
  ];
  return (
    <nav className="primary-nav" aria-label="Primary">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) =>
            isActive ? 'primary-nav-item active' : 'primary-nav-item'
          }
        >
          {t(`nav.${it.key}` as const)}
        </NavLink>
      ))}
      {/* Trailing quick-capture button — flex auto-margin pushes it to the
          right edge of the nav strip so 速记 is always one click away from
          wherever the user is. The Cmd+Shift+N hotkey still works globally
          (handled in AppLayout). */}
      <button
        type="button"
        className="primary-nav-capture"
        onClick={() =>
          window.dispatchEvent(new CustomEvent('rp:open-capture'))
        }
        title={t('capture.openHotkeyHint')}
        style={{ marginLeft: 'auto' }}
      >
        {t('capture.openButton')}
      </button>
    </nav>
  );
}
