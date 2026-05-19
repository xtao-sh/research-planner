import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EventRecord, EventType } from '@rp/shared';
import { getProjectActivity, getWorkspaceActivity } from '../../api/activity';
import { formatRelative } from '../../utils/time';

interface ActivityPanelProps {
  scope: 'workspace' | 'project';
  id: string;
  /** When provided, panel renders inside a modal overlay with a close button. */
  onClose?: () => void;
  /**
   * Integer that increments whenever the parent wants the panel to re-fetch
   * its first page (e.g. after a WebSocket push). The value is opaque — only
   * the change is significant.
   */
  refreshTrigger?: number;
}

interface ActivityPanelContentProps {
  scope: 'workspace' | 'project';
  id: string;
  refreshTrigger?: number;
}

export function ActivityPanelContent({ scope, id, refreshTrigger }: ActivityPanelContentProps) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);

  const fetchPage = useCallback(
    async (before?: string) => {
      const fetcher = scope === 'workspace' ? getWorkspaceActivity : getProjectActivity;
      return fetcher(id, { limit: PAGE_SIZE, before });
    },
    [scope, id]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage()
      .then((rows) => {
        if (cancelled) return;
        setEvents(rows);
        setHasMore(rows.length >= PAGE_SIZE);
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
  }, [fetchPage, refreshTrigger]);

  const onLoadMore = useCallback(async () => {
    if (events.length === 0) return;
    const oldest = events[events.length - 1];
    setLoadingMore(true);
    try {
      const more = await fetchPage(oldest.createdAt);
      setEvents((prev) => [...prev, ...more]);
      setHasMore(more.length >= PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }, [events, fetchPage]);

  return (
    <>
      {loading && <p>{t('common.loading')}</p>}
      {error && (
        <p className="error-message" style={{ marginBottom: '0.5rem' }}>
          {error}
        </p>
      )}

      {!loading && !error && events.length === 0 && (
        <p style={{ color: 'var(--muted-color, #666)' }}>{t('event.empty')}</p>
      )}

      {!loading && !error && events.length > 0 && (
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {events.map((e, idx) => {
              const icon = EVENT_ICON[e.type] ?? '•';
              const sentence = (t as (k: string, v?: Record<string, unknown>) => string)(
                EVENT_I18N_KEY[e.type] ?? e.type,
                eventPayloadValues(e.payload)
              );
              const rel = formatRelative(e.createdAt);
              const relText = (t as (k: string, v?: Record<string, unknown>) => string)(
                rel.key,
                rel.values ?? {}
              );
              return (
                <li
                  key={e.id}
                  style={{
                    display: 'flex',
                    gap: '0.6rem',
                    padding: '0.5rem 0.25rem',
                    borderTop: idx === 0 ? 'none' : '1px solid var(--border-color, #eee)',
                    alignItems: 'flex-start',
                  }}
                >
                  <span style={{ fontSize: '1.1rem', lineHeight: '1.3rem' }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.9rem' }}>
                      {/* Single-user local mode: actor email is always the
                       * local user, so we drop it to reduce visual noise. */}
                      <span>{sentence}</span>
                    </div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--muted-color, #888)',
                        marginTop: 2,
                      }}
                    >
                      {relText}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
              <button
                type="button"
                className="export-button"
                onClick={() => void onLoadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? t('common.loading') : t('event.loadMore')}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const PAGE_SIZE = 50;

// Map event types to emojis for a compact visual cue.
export const EVENT_ICON: Record<EventType, string> = {
  'project.created': '📁',
  'project.updated': '📁',
  'project.deleted': '🗑️',
  'task.created': '✅',
  'task.updated': '✅',
  'task.deleted': '🗑️',
  'dependency.created': '🔗',
  'dependency.deleted': '🔗',
  'milestone.created': '🏁',
  'milestone.updated': '🏁',
  'milestone.deleted': '🏁',
  'scenario.created': '💾',
  'scenario.deleted': '💾',
  'workspace.created': '🏢',
  'workspace.member.invited': '👥',
  'workspace.member.removed': '👥',
  'workspace.member.role_changed': '🔑',
  'workspace.owner.transferred': '👑',
  'workspace.calendar.updated': '📅',
  'workspace.holiday.added': '🗓️',
  'workspace.holiday.removed': '🗓️',
  'workspace.invite.created': '📧',
  'workspace.invite.revoked': '🚫',
  'workspace.invite.accepted': '🎉',
  'note.created': '📝',
  'note.updated': '📝',
};

// Map event types to the i18n key + which payload fields to interpolate.
export const EVENT_I18N_KEY: Record<EventType, string> = {
  'project.created': 'event.projectCreated',
  'project.updated': 'event.projectUpdated',
  'project.deleted': 'event.projectDeleted',
  'task.created': 'event.taskCreated',
  'task.updated': 'event.taskUpdated',
  'task.deleted': 'event.taskDeleted',
  'dependency.created': 'event.dependencyCreated',
  'dependency.deleted': 'event.dependencyDeleted',
  'milestone.created': 'event.milestoneCreated',
  'milestone.updated': 'event.milestoneUpdated',
  'milestone.deleted': 'event.milestoneDeleted',
  'scenario.created': 'event.scenarioCreated',
  'scenario.deleted': 'event.scenarioDeleted',
  'workspace.created': 'event.workspaceCreated',
  'workspace.member.invited': 'event.memberInvited',
  'workspace.member.removed': 'event.memberRemoved',
  'workspace.member.role_changed': 'event.memberRoleChanged',
  'workspace.owner.transferred': 'event.ownerTransferred',
  'workspace.calendar.updated': 'event.calendarUpdated',
  'workspace.holiday.added': 'event.holidayAdded',
  'workspace.holiday.removed': 'event.holidayRemoved',
  'workspace.invite.created': 'event.inviteCreated',
  'workspace.invite.revoked': 'event.inviteRevoked',
  'workspace.invite.accepted': 'event.inviteAccepted',
  'note.created': 'event.noteCreated',
  'note.updated': 'event.noteFiled',
};

export function eventPayloadValues(payload: unknown): Record<string, string | number> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  const out: Record<string, string | number> = {};
  for (const k of ['title', 'name', 'email', 'role', 'fromRole', 'toRole', 'project']) {
    if (typeof p[k] === 'string' || typeof p[k] === 'number') {
      out[k] = p[k] as string | number;
    }
  }
  return out;
}

export function ActivityPanel({ scope, id, onClose, refreshTrigger }: ActivityPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
        <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>{t('event.activityFeed')}</h3>
        <ActivityPanelContent scope={scope} id={id} refreshTrigger={refreshTrigger} />
      </div>
    </div>
  );
}
