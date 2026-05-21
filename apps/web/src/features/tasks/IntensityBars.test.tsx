import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { IntensityBars } from './IntensityBars';
import type { Task } from '@rp/shared';

const testI18n = i18n.createInstance();
testI18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      translation: {
        task: { intensityHint: 'load ×{{n}}' },
      },
    },
  },
});

function mkTask(o: Partial<Task> = {}): Task {
  return {
    id: 't', projectId: 'p', title: '', type: 'research',
    status: 'todo', estimate: { o: 1, m: 1, p: 1 }, priority: 1, size: 'm',
    ...o,
  };
}

function rendered(node: React.ReactElement) {
  return render(<I18nextProvider i18n={testI18n}>{node}</I18nextProvider>);
}

describe('IntensityBars', () => {
  it('renders nothing when intensity is null (size-derived)', () => {
    const { container } = rendered(
      <IntensityBars task={mkTask({ intensity: undefined })} />
    );
    expect(container.querySelector('.rd-intensity')).toBeNull();
  });

  it('renders nothing when intensity is explicitly undefined', () => {
    const { container } = rendered(<IntensityBars task={mkTask()} />);
    expect(container.querySelector('.rd-intensity')).toBeNull();
  });

  it('renders bars when intensity is explicitly set', () => {
    const { container } = rendered(
      <IntensityBars task={mkTask({ intensity: 4 })} />
    );
    const el = container.querySelector('.rd-intensity');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('data-level')).toBe('4');
    expect(el!.querySelectorAll('.rd-bar')).toHaveLength(5);
  });

  it('alwaysRender=true forces bars when intensity is null', () => {
    const { container } = rendered(
      <IntensityBars task={mkTask({ intensity: undefined })} alwaysRender />
    );
    const el = container.querySelector('.rd-intensity');
    expect(el).not.toBeNull();
    // Size 'm' derives to intensity 3.
    expect(el!.getAttribute('data-level')).toBe('3');
  });

  it('aria-label includes the resolved intensity value', () => {
    const { container } = rendered(
      <IntensityBars task={mkTask({ intensity: 5 })} />
    );
    expect(container.querySelector('.rd-intensity')!.getAttribute('aria-label'))
      .toBe('load ×5');
  });
});
