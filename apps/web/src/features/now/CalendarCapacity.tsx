import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import { deriveIntensity } from '../../shared/intensity';

/** Build a YYYY-MM-DD key in local time so we can compare against
 *  date-only fields without TZ drift. */
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse an ISO date or date-time and return its local-day key. */
function isoToLocalDayKey(iso: string): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return localDayKey(d);
}

function intensityForTask(task: Task): number {
  return deriveIntensity(task);
}

/** Calendar capacity widget — sits below the today gauge in /now's right
 *  rail. Shows projected intensity-load over the next 7 days, derived from
 *  task plan/due dates. Read-only: no fetches, no mutations. */
export function CalendarCapacity() {
  const { t, i18n } = useTranslation();
  const { projects, projectTasks } = useAppData();

  const allTasks = useMemo<Task[]>(() => {
    const out: Task[] = [];
    for (const project of projects) {
      const ts = projectTasks[project.id];
      if (!ts) continue;
      for (const task of ts) out.push(task);
    }
    return out;
  }, [projects, projectTasks]);

  const days = useMemo(() => {
    // Build the next 7 days (today + 6) at local-midnight boundaries.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const list: { iso: string; weekday: string; date: string; load: number }[] = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = localDayKey(d);
      const weekday = d.toLocaleDateString(i18n.language, { weekday: "short" });
      const date = `${d.getMonth() + 1}/${d.getDate()}`;
      list.push({ iso, weekday, date, load: 0 });
    }

    const dayIndex = new Map<string, number>();
    list.forEach((d, idx) => dayIndex.set(d.iso, idx));

    for (const task of allTasks) {
      // Tasks already done don't burn future capacity.
      if (task.status === 'done') continue;
      const intensity = intensityForTask(task);
      const hits = new Set<number>();

      const point = (iso?: string) => {
        if (!iso) return;
        const key = isoToLocalDayKey(iso);
        if (!key) return;
        const idx = dayIndex.get(key);
        if (idx !== undefined) hits.add(idx);
      };
      point(task.dueSoft);
      point(task.dueHard);
      point(task.startPlanned);
      point(task.endPlanned);

      // Span coverage: if startPlanned and endPlanned bracket any of the
      // 7 days, count the load on each day in between as well.
      if (task.startPlanned && task.endPlanned) {
        const start = new Date(task.startPlanned);
        const end = new Date(task.endPlanned);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && start <= end) {
          for (let i = 0; i < list.length; i++) {
            // Day boundaries: [day 00:00, next day 00:00)
            const dayStart = new Date(list[i].iso + 'T00:00:00');
            const dayEnd = new Date(dayStart);
            dayEnd.setDate(dayStart.getDate() + 1);
            if (start < dayEnd && end >= dayStart) hits.add(i);
          }
        }
      }

      for (const idx of hits) {
        list[idx].load += intensity;
      }
    }

    return list;
    // i18n.language so weekday labels re-render on a live language switch.
  }, [allTasks, i18n.language]);

  return (
    <div className="rd-capacity-card">
      <div className="rd-capacity-title">{t('now.calendarTitle')}</div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        {t('now.calendarSub')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {days.map((d) => {
          const level = Math.max(1, Math.min(5, Math.ceil(d.load / 2)));
          return (
            <div
              key={d.iso}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12,
              }}
            >
              <span style={{ width: 38, color: 'var(--rd-ink-3)' }}>
                {d.weekday}
              </span>
              <span
                className="mono"
                style={{ width: 36, color: 'var(--rd-ink-3)', fontSize: 11 }}
              >
                {d.date}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 12,
                  background: 'var(--rd-bg-sunk)',
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, (d.load / 8) * 100)}%`,
                    height: '100%',
                    background:
                      d.load > 0 ? `var(--intens-${level})` : 'transparent',
                  }}
                />
              </div>
              <span
                className="mono"
                style={{
                  width: 32,
                  fontSize: 11,
                  color: 'var(--rd-ink-3)',
                  textAlign: 'right',
                }}
              >
                {d.load}/8
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
