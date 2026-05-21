import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { TimeframeChipGroup } from './TimeframeChipGroup';
import type { TimeframeBucket } from '@rp/shared';

const testI18n = i18n.createInstance();
testI18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      translation: {
        timeframe: {
          label: 'Timeframe',
          buckets: {
            week: 'Week',
            month: 'Month',
            quarter: 'Quarter',
            year: 'Year',
            someday: 'Someday',
          },
        },
      },
    },
  },
});

function Harness({ initial }: { initial: TimeframeBucket | null }) {
  const [v, setV] = useState<TimeframeBucket | null>(initial);
  return (
    <I18nextProvider i18n={testI18n}>
      <TimeframeChipGroup value={v} onChange={setV} />
      <div data-testid="value">{v ?? 'null'}</div>
    </I18nextProvider>
  );
}

describe('TimeframeChipGroup', () => {
  it('renders all five buckets', () => {
    render(<Harness initial={null} />);
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quarter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Year' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Someday' })).toBeInTheDocument();
  });

  it('clicking a chip selects it and aria-pressed becomes true', () => {
    render(<Harness initial={null} />);
    expect(screen.getByTestId('value').textContent).toBe('null');
    const month = screen.getByRole('button', { name: 'Month' });
    fireEvent.click(month);
    expect(screen.getByTestId('value').textContent).toBe('month');
    expect(month.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking the selected chip clears it when allowClear is default', () => {
    render(<Harness initial="week" />);
    const week = screen.getByRole('button', { name: 'Week' });
    expect(week.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(week);
    expect(screen.getByTestId('value').textContent).toBe('null');
    expect(week.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking a different chip switches selection (not toggle)', () => {
    render(<Harness initial="week" />);
    fireEvent.click(screen.getByRole('button', { name: 'Quarter' }));
    expect(screen.getByTestId('value').textContent).toBe('quarter');
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect(
      screen.getByRole('button', { name: 'Quarter' }).getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('respects allowClear=false (no toggle-off)', () => {
    const onChange = vi.fn();
    render(
      <I18nextProvider i18n={testI18n}>
        <TimeframeChipGroup value="week" onChange={onChange} allowClear={false} />
      </I18nextProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    // With allowClear=false, clicking the active chip should re-emit the same
    // value (not null).
    expect(onChange).toHaveBeenCalledWith('week');
  });
});
