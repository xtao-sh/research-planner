// Task form state shape and helpers shared by the task form UI.

import type { Task, TaskSize, TimeframeBucket } from '@rp/shared';

export type TaskFormState = {
  title: string;
  type: Task['type'];
  status: Task['status'];
  priority: number;
  size: TaskSize;
  intensity: number | null;
  estimate: { o: number; m: number; p: number; confidence?: number };
  dueSoft: string;
  dueHard: string;
  /** Fuzzy 'finish-in-about' bucket. null = no bucket. */
  timeframeBucket: TimeframeBucket | null;
  /** Anchor ISO date-time. Read-only from the form's perspective — the
   *  server fills it on first set; the UI only displays the countdown. */
  timeframeAnchor: string | null;
  assignee: string;
  notes: string;
  milestoneId: string;
  /** Parent task id — empty string means top-level. */
  parentTaskId: string;
};

export const typeOptions: Task['type'][] = [
  'thinking',
  'reading',
  'research',
  'experiment',
  'coding',
  'analysis',
  'writing',
  'communication',
  'admin',
];

export const statusOptions: Task['status'][] = ['todo', 'doing', 'blocked', 'review', 'done'];

export const sizeOptions: { value: TaskSize; labelKey: string; hours: string }[] = [
  { value: 'xs', labelKey: 'task.size.xs', hours: '≤1h' },
  { value: 's',  labelKey: 'task.size.s',  hours: '~2-4h' },
  { value: 'm',  labelKey: 'task.size.m',  hours: '~4-8h' },
  { value: 'l',  labelKey: 'task.size.l',  hours: '~1-3d' },
  { value: 'xl', labelKey: 'task.size.xl', hours: '~1w+' },
];

export function sizeLabelKey(size: TaskSize): string {
  return `task.size.${size}`;
}

export function defaultForm(): TaskFormState {
  return {
    title: '',
    type: 'research',
    status: 'todo',
    priority: 1,
    size: 'm',
    intensity: null,
    estimate: { o: 1, m: 1, p: 1 },
    dueSoft: '',
    dueHard: '',
    timeframeBucket: null,
    timeframeAnchor: null,
    assignee: '',
    notes: '',
    milestoneId: '',
    parentTaskId: '',
  };
}

export function formatDateInput(value?: string) {
  if (!value) return '';
  return value.slice(0, 10);
}

export function parseDateInput(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).toISOString();
}
