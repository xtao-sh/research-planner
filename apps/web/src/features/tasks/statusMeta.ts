// Shared status metadata. The colors mirror the --status-* CSS tokens in
// App.css so JS-side and CSS-side stay in sync. Used as the "dot" color on
// status badges and as the leading-rule color on /now task rows.
import type { Task } from '@rp/shared';

export const STATUS_COLOR: Record<Task['status'], string> = {
  todo: '#8a8478',     // graphite — matches --status-todo
  doing: '#2f5dc8',    // vivid blue — matches --status-doing
  blocked: '#b73420',  // vivid red — matches --status-blocked
  review: '#c4881e',   // vivid amber — matches --status-review
  done: '#2f6d3a',     // vivid moss — matches --status-done
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
