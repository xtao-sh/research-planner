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

export function nextStatus(current: Task['status']): Task['status'] {
  if (current === 'blocked') return 'doing';
  const idx = STATUS_CYCLE.indexOf(current);
  if (idx < 0) return 'doing';
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}
