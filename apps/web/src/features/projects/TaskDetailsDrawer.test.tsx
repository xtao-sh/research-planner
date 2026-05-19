import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { TaskDetailsDrawer } from './TaskDetailsDrawer';
import { defaultForm } from '../task-form/form';

const testI18n = i18n.createInstance();
testI18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      translation: {
        task: {
          type: 'Type',
          dueSoft: 'Soft due',
          milestone: 'Milestone',
          advanced: 'Advanced',
          advancedHint: '',
          estimateLabel: 'Estimate',
          tagsLabel: 'Tags',
          drawer: { title: 'More details', close: 'Close' },
          typeLabels: {
            thinking: 'Thinking', reading: 'Reading', research: 'Research',
            experiment: 'Experiment', coding: 'Coding', analysis: 'Analysis',
            writing: 'Writing', communication: 'Communication', admin: 'Admin',
          },
        },
        common: { save: 'Save', saving: 'Saving', none: 'None' },
      },
    },
  },
});

function withI18n(ui: React.ReactNode) {
  return <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>;
}

function defaultProps(overrides: Partial<React.ComponentProps<typeof TaskDetailsDrawer>> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    form: defaultForm(),
    setForm: () => {},
    selectedTask: null,
    saving: false,
    canWriteActiveWorkspace: true,
    isDeadlineMode: false,
    milestones: [],
    predecessors: [],
    addableTasks: [],
    tasks: [],
    newDepSourceId: '',
    setNewDepSourceId: () => {},
    newDepType: 'FS' as const,
    setNewDepType: () => {},
    newDepLag: 0,
    setNewDepLag: () => {},
    onSave: vi.fn(),
    onAddDependency: () => {},
    onRemoveDependency: () => {},
    ...overrides,
  };
}

describe('TaskDetailsDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(withI18n(<TaskDetailsDrawer {...defaultProps({ open: false })} />));
    expect(container.querySelector('.task-modal')).toBeNull();
  });

  it('closes on ESC key', () => {
    const onClose = vi.fn();
    render(withI18n(<TaskDetailsDrawer {...defaultProps({ onClose })} />));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    const { container } = render(withI18n(<TaskDetailsDrawer {...defaultProps({ onClose })} />));
    const backdrop = container.querySelector('.task-modal-backdrop') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows close buttons labelled by drawer.close', () => {
    render(withI18n(<TaskDetailsDrawer {...defaultProps()} />));
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });
});
