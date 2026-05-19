// Project re-entry briefing.
//
// Always renders at the top of `/projects/:id`. Two sizes:
//
// - Stale (>3 days idle): full amber banner with counts, recent activity,
//   latest note (with tags), and a "currently focused" mini-list. Lets the
//   user pick up where they left off without scrolling around.
// - Fresh (<=3 days): compact one-line neutral pill with the same gist
//   (last touched, doing/blocked counts, focused tasks).
//
// Dismissing the full panel hides it for the rest of the session. The compact
// strip is never dismissable — it's tiny and always informative.

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EventRecord, Note, Project, Task } from '@rp/shared';
import { getProjectActivity } from '../../api/activity';
import { formatRelative } from '../../utils/time';
import {
  EVENT_ICON,
  EVENT_I18N_KEY,
  eventPayloadValues,
} from '../activity/ActivityPanel';

const DAY_MS = 86_400_000;
const STALE_THRESHOLD_DAYS = 3;
const RECENT_ACTIVITY_LIMIT = 3;
const FOCUSED_PREVIEW_LIMIT = 3;

function dismissalKey(projectId: string) {
  return `rp.briefing.dismissed.${projectId}`;
}

interface ProjectBriefingProps {
  project: Project;
  tasks: Task[];
  /** Project notes — passed in from ProjectDetailPage which already loads
   *  them for the ReviewReport. Saves a duplicate fetch. */
  notes: Note[];
}

type TFn = (k: string, v?: Record<string, unknown>) => string;

interface Counts {
  doing: number;
  blocked: number;
  notes: number;
  focused: number;
}

function activitySentence(
  t: TFn,
  e: EventRecord
): { icon: string; sentence: string; rel: ReturnType<typeof formatRelative> } {
  const icon = EVENT_ICON[e.type] ?? '•';
  const sentence = t(
    EVENT_I18N_KEY[e.type] ?? e.type,
    eventPayloadValues(e.payload)
  );
  return { icon, sentence, rel: formatRelative(e.createdAt) };
}

function extractTags(body: string): string[] {
  const matches = body.match(/#[\p{L}\p{N}_-]+/gu);
  return matches ? Array.from(new Set(matches)) : [];
}

export function ProjectBriefing({ project, tasks, notes }: ProjectBriefingProps) {
  const { t } = useTranslation();

  const days = useMemo(
    () =>
      Math.floor(
        (Date.now() - new Date(project.updatedAt).getTime()) / DAY_MS
      ),
    [project.updatedAt]
  );
  const isStale = days >= STALE_THRESHOLD_DAYS;
  const lastTouchedRel = useMemo(
    () => formatRelative(project.updatedAt),
    [project.updatedAt]
  );
  const lastTouchedText = (t as TFn)(lastTouchedRel.key, lastTouchedRel.values);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(dismissalKey(project.id)) === '1';
    } catch {
      return false;
    }
  });

  // Reset dismissal when the project changes.
  useEffect(() => {
    try {
      const flag = window.sessionStorage.getItem(dismissalKey(project.id));
      setDismissed(flag === '1');
    } catch {
      setDismissed(false);
    }
  }, [project.id]);

  const [recentEvents, setRecentEvents] = useState<EventRecord[]>([]);

  // Only the full version needs activity; skip the fetch for the compact strip.
  const showFull = isStale && !dismissed;
  useEffect(() => {
    if (!showFull) return;
    let cancelled = false;
    (async () => {
      try {
        const evts = await getProjectActivity(project.id, {
          limit: RECENT_ACTIVITY_LIMIT,
        });
        if (!cancelled) setRecentEvents(evts);
      } catch {
        if (!cancelled) setRecentEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, showFull]);

  const focusedTasks = useMemo(
    () => tasks.filter((tk) => tk.focusedAt != null),
    [tasks]
  );

  const counts: Counts = useMemo(
    () => ({
      doing: tasks.filter((tk) => tk.status === 'doing').length,
      blocked: tasks.filter((tk) => tk.status === 'blocked').length,
      notes: notes.length,
      focused: focusedTasks.length,
    }),
    [tasks, notes.length, focusedTasks.length]
  );

  // Compact strip — always shown, even when the full panel is also visible.
  // (When the user dismisses the full panel, only the compact strip remains.)
  const compactStrip = (
    <div className="briefing-compact" role="status">
      <span>
        {(t as TFn)('briefing.compactSummary', {
          when: lastTouchedText,
          doing: counts.doing,
          blocked: counts.blocked,
          notes: counts.notes,
          focused: counts.focused,
        })}
      </span>
    </div>
  );

  if (!showFull) {
    return compactStrip;
  }

  // Full version — stale, not dismissed.
  const latestNote = notes[0];
  const latestNoteTags = latestNote ? extractTags(latestNote.body) : [];

  function handleDismiss() {
    try {
      window.sessionStorage.setItem(dismissalKey(project.id), '1');
    } catch {
      /* ignore quota / privacy errors */
    }
    setDismissed(true);
  }

  // Adopt the redesign's warm gradient briefing — eyebrow + headline +
  // 3-cell context grid (last activity / loose end / open thought) +
  // action row.
  const looseEndText = counts.blocked > 0
    ? (t as TFn)('briefing.looseEndBlocked', { count: counts.blocked })
    : null;
  const lastActivityText = recentEvents.length > 0
    ? activitySentence(t as TFn, recentEvents[0]).sentence
    : null;
  const openThoughtText = latestNote
    ? `"${latestNote.body.length > 110 ? `${latestNote.body.slice(0, 110)}…` : latestNote.body}"`
    : null;

  return (
    <>
      {compactStrip}
      <section
        className="rd-briefing"
        role="region"
        aria-label={(t as TFn)('briefing.title')}
      >
        <button
          type="button"
          className="rd-briefing-close"
          onClick={handleDismiss}
          title={(t as TFn)('briefing.dismiss')}
          aria-label={(t as TFn)('briefing.dismiss')}
        >
          ×
        </button>
        <div className="rd-briefing-eyebrow">
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: `var(--type-${project.type})`,
            }}
            aria-hidden="true"
          />
          {(t as TFn)('briefing.title')} · {project.name}
        </div>
        <h2>
          {(t as TFn)('briefing.lastTouched', { when: lastTouchedText })}
        </h2>
        <div className="rd-briefing-grid">
          {lastActivityText && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{(t as TFn)('briefing.recentActivity')}</div>
              <div className="rd-val">{lastActivityText}</div>
            </div>
          )}
          {looseEndText && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{(t as TFn)('briefing.looseEnd')}</div>
              <div className="rd-val">{looseEndText}</div>
            </div>
          )}
          {openThoughtText && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{(t as TFn)('briefing.openThought')}</div>
              <div className="rd-val" title={latestNote!.body}>
                {openThoughtText}
                {latestNoteTags.length > 0 && (
                  <span
                    style={{
                      color: 'var(--rd-ink-3)',
                      fontWeight: 400,
                      fontSize: 11,
                      marginLeft: 6,
                    }}
                  >
                    {latestNoteTags.slice(0, 3).join(' ')}
                  </span>
                )}
              </div>
            </div>
          )}
          {focusedTasks.length > 0 && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">⭐ {(t as TFn)('briefing.currentlyFocused')}</div>
              <div className="rd-val">
                {focusedTasks
                  .slice(0, FOCUSED_PREVIEW_LIMIT)
                  .map((tk) => tk.title)
                  .join(' · ')}
              </div>
            </div>
          )}
        </div>
        <div className="rd-briefing-actions">
          <button
            type="button"
            className="rd-btn rd-btn-primary rd-btn-sm"
            onClick={handleDismiss}
          >
            {(t as TFn)('briefing.backToWork')}
          </button>
          <button
            type="button"
            className="rd-btn rd-btn-ghost rd-btn-sm"
            onClick={handleDismiss}
          >
            {(t as TFn)('briefing.dismiss')}
          </button>
        </div>
      </section>
    </>
  );
}
