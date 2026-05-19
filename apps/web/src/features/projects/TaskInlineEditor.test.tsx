import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { TaskInlineEditor } from './TaskInlineEditor';
import { defaultForm, TaskFormState } from '../task-form/form';
import type { Task } from '@rp/shared';

const testI18n = i18n.createInstance();
testI18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      translation: {
        task: {
          title: 'Title',
          status: 'Status',
          sizeLabel: 'Size',
          dueHard: 'Due hard',
          notes: 'Notes',
          size: { xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL' },
          statusLabels: {
            todo: 'To do',
            doing: 'Doing',
            blocked: 'Blocked',
            review: 'Review',
            done: 'Done',
          },
          inlineEditor: {
            region: 'Inline editor',
            delete: 'Delete',
            save: 'Save',
            cancel: 'Cancel',
            moreDetails: 'More details',
          },
        },
        common: { saving: 'Saving' },
        role: { viewer: 'Viewer' },
      },
    },
  },
});

function withI18n(ui: React.ReactNode) {
  return <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>;
}

// Drives a real `setForm` so we exercise the same controlled-input flow that
// ProjectDetailPage uses. This is the regression test for the "can't modify
// task description" bug — the textarea must remain editable and emit the
// typed value back to the caller via onSave.
function Harness({
  initial,
  selectedTask,
  onSave,
}: {
  initial: TaskFormState;
  selectedTask: Task | null;
  onSave: (state: TaskFormState) => void;
}) {
  const [form, setForm] = useState<TaskFormState>(initial);
  return (
    <TaskInlineEditor
      form={form}
      setForm={setForm}
      selectedTask={selectedTask}
      saving={false}
      canWriteActiveWorkspace={true}
      onSave={() => onSave(form)}
      onDelete={() => {}}
      onCancel={() => {}}
      onOpenDrawer={() => {}}
    />
  );
}

const sampleTask: Task = {
  id: 't1',
  projectId: 'p1',
  title: 'Sample',
  type: 'research',
  status: 'todo',
  estimate: { o: 1, m: 2, p: 3 },
  priority: 1,
  size: 'm',
  notes: 'old description',
};

describe('TaskInlineEditor', () => {
  it('lets the user edit the notes textarea and forwards the value to onSave', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      withI18n(
        <Harness
          initial={{ ...defaultForm(), title: 'Sample', notes: 'old description' }}
          selectedTask={sampleTask}
          onSave={onSave}
        />
      )
    );

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('old description');

    await user.clear(textarea);
    await user.type(textarea, 'new description');
    expect(textarea.value).toBe('new description');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].notes).toBe('new description');
  });

  it('disables Save when the workspace is read-only', () => {
    render(
      withI18n(
        <TaskInlineEditor
          form={defaultForm()}
          setForm={() => {}}
          selectedTask={null}
          saving={false}
          canWriteActiveWorkspace={false}
          onSave={() => {}}
          onDelete={() => {}}
          onCancel={() => {}}
          onOpenDrawer={() => {}}
        />
      )
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a delete button for an existing task and not for a new one', () => {
    const { rerender } = render(
      withI18n(
        <TaskInlineEditor
          form={defaultForm()}
          setForm={() => {}}
          selectedTask={sampleTask}
          saving={false}
          canWriteActiveWorkspace={true}
          onSave={() => {}}
          onDelete={() => {}}
          onCancel={() => {}}
          onOpenDrawer={() => {}}
        />
      )
    );
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeNull();

    rerender(
      withI18n(
        <TaskInlineEditor
          form={defaultForm()}
          setForm={() => {}}
          selectedTask={null}
          saving={false}
          canWriteActiveWorkspace={true}
          onSave={() => {}}
          onDelete={() => {}}
          onCancel={() => {}}
          onOpenDrawer={() => {}}
        />
      )
    );
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
