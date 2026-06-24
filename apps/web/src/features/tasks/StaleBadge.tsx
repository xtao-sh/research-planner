import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '@rp/shared';
import { getTaskStaleLevel } from './staleTask';

// Small chip that appears next to a task when it has gone stale.
//   - yellow ⏳ when `doing` for >= 7 days
//   - red    🚫 when `blocked` for >= 3 days
// Returns null when the task is fresh.
export function StaleBadge({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { level, days } = getTaskStaleLevel(task);
  if (level === 'fresh') return null;

  const isDoing = level === 'doing-stale';
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.125rem 0.5rem',
    borderRadius: 999,
    fontSize: '0.75rem',
    fontWeight: 600,
    background: isDoing ? 'var(--st-review-bg)' : 'var(--st-blocked-bg)',
    color: isDoing ? 'var(--st-review-fg)' : 'var(--st-blocked-fg)',
  };
  const label = isDoing
    ? t('task.staleDoing', { n: days })
    : t('task.staleBlocked', { n: days });
  return (
    <span className="stale-badge" style={style} title={label}>
      <span aria-hidden="true">{isDoing ? '⏳' : '🚫'}</span>
      <span>{label}</span>
    </span>
  );
}
