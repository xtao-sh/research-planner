import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { StaleBadge } from './StaleBadge';
import type { Task } from '@rp/shared';

// Minimal i18n setup for component tests — pulls just the keys we need.
const testI18n = i18n.createInstance();
testI18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      translation: {
        task: {
          staleDoing: 'In progress {{n}}d',
          staleBlocked: 'Blocked {{n}}d',
        },
      },
    },
  },
});

function mkTask(o: Partial<Task> = {}): Task {
  return {
    id: 't', projectId: 'p', title: '', type: 'research',
    status: 'todo', estimate: { o: 1, m: 1, p: 1 },
    priority: 1, size: 'm', ...o,
  };
}

function withI18n(ui: React.ReactNode) {
  return <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>;
}

describe('StaleBadge', () => {
  it('renders nothing for fresh tasks', () => {
    const { container } = render(withI18n(<StaleBadge task={mkTask()} />));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders doing-stale label for long-running doing tasks', () => {
    const startedAt = new Date(Date.now() - 8 * 86400000).toISOString();
    render(
      withI18n(
        <StaleBadge task={mkTask({ status: 'doing', startedAt })} />
      )
    );
    expect(screen.getByText(/In progress 8d/)).toBeInTheDocument();
  });

  it('renders blocked-stale label for long-blocked tasks', () => {
    const blockedAt = new Date(Date.now() - 5 * 86400000).toISOString();
    render(
      withI18n(
        <StaleBadge task={mkTask({ status: 'blocked', blockedAt })} />
      )
    );
    expect(screen.getByText(/Blocked 5d/)).toBeInTheDocument();
  });
});
