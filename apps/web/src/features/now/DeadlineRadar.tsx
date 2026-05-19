import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project, Task } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';

interface RadarItem {
  task: Task;
  project: Project;
  daysFromNow: number;
  kind: 'hard' | 'soft';
}

/** Deadline radar — surfaces the next handful of soft/hard due dates across
 *  every project in one place. Lives in the right rail of /now under the
 *  capacity widgets so the user sees urgency without leaving the page. The
 *  card hides itself entirely when nothing is upcoming so the rail stays
 *  quiet during slack weeks. */
export function DeadlineRadar() {
  const { t } = useTranslation();
  const { projects, projectTasks } = useAppData();

  const items = useMemo<RadarItem[]>(() => {
    const out: RadarItem[] = [];
    const now = Date.now();
    for (const project of projects) {
      const ts = projectTasks[project.id];
      if (!ts) continue;
      for (const task of ts) {
        if (task.status === 'done') continue;
        const hard = task.dueHard;
        const soft = task.dueSoft;
        const active = hard ?? soft;
        if (!active) continue;
        const kind: 'hard' | 'soft' = hard ? 'hard' : 'soft';
        const deadlineMs = new Date(active).getTime();
        if (Number.isNaN(deadlineMs)) continue;
        const daysFromNow = Math.floor((deadlineMs - now) / 86_400_000);
        out.push({ task, project, daysFromNow, kind });
      }
    }
    out.sort((a, b) => a.daysFromNow - b.daysFromNow);
    return out.slice(0, 6);
  }, [projects, projectTasks]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="rd-capacity-card">
      <div className="rd-capacity-title">{t('now.deadlineRadarTitle')}</div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        {t('now.deadlineRadarSub')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(({ task, project, daysFromNow, kind }) => {
          const overdue = daysFromNow < 0;
          const urgent = daysFromNow >= 0 && daysFromNow <= 3;
          const badgeColor =
            overdue || (kind === 'hard' && urgent)
              ? 'var(--rd-st-blocked)'
              : urgent
                ? 'var(--rd-st-review)'
                : 'var(--rd-ink-3)';
          const badgeBg =
            overdue || (kind === 'hard' && urgent)
              ? 'var(--rd-st-blocked-tint)'
              : urgent
                ? 'var(--rd-st-review-tint)'
                : 'var(--rd-bg-sunk)';
          const label = overdue
            ? t('now.deadlineOverdue', { n: -daysFromNow })
            : daysFromNow === 0
              ? t('now.deadlineToday')
              : t('now.deadlineInDays', { n: daysFromNow });
          return (
            <div
              key={task.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                fontSize: 12.5,
              }}
            >
              <span
                className="mono"
                style={{
                  flex: '0 0 76px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: badgeColor,
                  background: badgeBg,
                  padding: '3px 8px',
                  borderRadius: 4,
                  textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {label}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: 'var(--rd-ink)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={task.title}
                >
                  {task.title}
                </div>
                <div
                  className="muted"
                  style={{
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 2,
                      background: `var(--type-${project.type})`,
                      display: 'inline-block',
                    }}
                  />
                  {project.name}
                  <span style={{ color: 'var(--rd-ink-4)' }}>·</span>
                  <span
                    style={{
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      fontWeight: 600,
                    }}
                  >
                    {kind === 'hard' ? t('task.dueHard') : t('task.dueSoft')}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
