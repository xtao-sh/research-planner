// Shared status metadata. The colors mirror the --status-* CSS tokens in
// App.css so JS-side and CSS-side stay in sync. Used as the "dot" color on
// status badges and as the leading-rule color on /now task rows.
import type { Task } from '@rp/shared';

// Theme-aware: point at the --rd-st-* CSS tokens, which switch in dark
// mode (the bare hex did not). All consumers use these in inline
// `style={{ background: ... }}`, where a CSS var resolves fine.
export const STATUS_COLOR: Record<Task['status'], string> = {
  todo: 'var(--rd-st-todo)',
  doing: 'var(--rd-st-doing)',
  blocked: 'var(--rd-st-blocked)',
  review: 'var(--rd-st-review)',
  done: 'var(--rd-st-done)',
};

// One-click cycle order (skips `blocked` — that's a directed state set
// from the inline editor, not a step in the natural progression).
const STATUS_CYCLE: Task['status'][] = ['todo', 'doing', 'review', 'done'];

/**
 * Next status in the one-click cycle.
 *
 * Round 17 safety change: `done` is now terminal — clicking the status
 * pill on a done task is a no-op (returns 'done'). Previously it
 * wrapped around to 'todo', which meant a single misclick on a done
 * row silently re-opened the task with no undo. To deliberately
 * re-open a done task the user must use the drawer / inline editor.
 */
export function nextStatus(current: Task['status']): Task['status'] {
  if (current === 'done') return 'done';
  if (current === 'blocked') return 'doing';
  const idx = STATUS_CYCLE.indexOf(current);
  if (idx < 0) return 'doing';
  // Cap at the last cycle entry rather than wrapping to the first.
  const next = idx + 1;
  return STATUS_CYCLE[Math.min(next, STATUS_CYCLE.length - 1)];
}
