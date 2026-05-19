import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EventRecord } from '@rp/shared';
import { getProjectActivity } from '../../api/activity';
import {
  EVENT_ICON,
  EVENT_I18N_KEY,
  eventPayloadValues,
} from '../activity/ActivityPanel';
import { formatRelative } from '../../utils/time';
import { SkeletonList } from '../../components/Skeleton';

interface ProjectTimelineTabProps {
  projectId: string;
  /** Bumps when parent wants the panel to re-fetch (e.g. WS event tick). */
  refreshTrigger?: number;
}

export function ProjectTimelineTab({
  projectId,
  refreshTrigger,
}: ProjectTimelineTabProps) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProjectActivity(projectId, { limit: 50 })
      .then((rows) => {
        if (cancelled) return;
        setEvents(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTrigger]);

  const tx = t as (k: string, v?: Record<string, unknown>) => string;

  if (loading) {
    return (
      <div className="card">
        <SkeletonList rows={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p className="error-message">{error}</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="card">
        <p style={{ color: 'var(--muted-color, #666)' }}>{t('event.empty')}</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="rd-activity">
        {events.map((e) => {
          const icon = EVENT_ICON[e.type] ?? '•';
          const sentence = tx(
            EVENT_I18N_KEY[e.type] ?? e.type,
            eventPayloadValues(e.payload)
          );
          const rel = formatRelative(e.createdAt);
          const relText = tx(rel.key, rel.values ?? {});
          return (
            <div key={e.id} className="rd-activity-row">
              <div className="rd-when">{relText}</div>
              <div className="rd-what">
                {icon} {sentence}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
