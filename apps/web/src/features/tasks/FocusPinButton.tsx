import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  focused: boolean;
  onToggle: () => void;
}

/**
 * Top of Mind / 今日聚焦 pin button. A small star that the user clicks to
 * pin/unpin a task to the `/now` page's Top of Mind card.
 *
 * Stops click propagation so clicking the star inside a row doesn't also
 * trigger the row's navigate / open behaviour.
 */
export function FocusPinButton({ focused, onToggle }: Props): JSX.Element {
  const { t } = useTranslation();
  const label = focused ? t('task.unpinFocus') : t('task.pinFocus');
  return (
    <button
      type="button"
      aria-pressed={focused}
      aria-label={label}
      title={label}
      className="btn-icon focus-pin-btn"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      style={{ marginLeft: 'auto' }}
    >
      {focused ? '★' : '☆'}
    </button>
  );
}
