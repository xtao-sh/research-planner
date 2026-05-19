import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { FocusPinButton } from './FocusPinButton';

const testI18n = i18n.createInstance();
testI18n.use(initReactI18next).init({
  lng: 'en', fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: { task: {
      pinFocus: 'Pin to Top of Mind',
      unpinFocus: 'Unpin from Top of Mind',
    }}},
  },
});

function withI18n(ui: React.ReactNode) {
  return <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>;
}

describe('FocusPinButton', () => {
  it('calls onToggle when an unpinned task is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(withI18n(<FocusPinButton focused={false} onToggle={onToggle} />));
    await user.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('calls onToggle when a pinned task is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(withI18n(<FocusPinButton focused={true} onToggle={onToggle} />));
    await user.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('uses aria-pressed to reflect state', () => {
    render(withI18n(<FocusPinButton focused={true} onToggle={() => {}} />));
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('stops click propagation so it does not bubble to row handlers', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onRowClick = vi.fn();
    render(
      withI18n(
        <div onClick={onRowClick}>
          <FocusPinButton focused={false} onToggle={onToggle} />
        </div>
      )
    );
    await user.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
