import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '@rp/shared';
import {
  deriveDailyCheckin,
  dismissDaily,
  isDailyDismissed,
  localDayStamp,
  pruneStaleDismissKeys,
} from './dailyCheckinData';

/**
 * Daily check-in card on /now. A derived, dismissible "yesterday → today →
 * blockers" glance — the daily half of the PRD's two-cadence review (§7.1.7).
 * No new data is fetched: `allTasks`, `focused`, and `blocked` are the lists
 * NowPage already derives. Dismiss is per-calendar-day (localStorage) so the
 * card returns fresh tomorrow.
 *
 * Reuses the re-entry briefing's CSS vocabulary (rd-briefing*) so the two
 * surfaces read as a coherent family; no new stylesheet rules.
 */
export function DailyCheckIn({
  allTasks,
  focused,
  blocked,
  onUnblock,
  onPinPrompt,
}: {
  allTasks: ReadonlyArray<Task>;
  focused: ReadonlyArray<Task>;
  blocked: ReadonlyArray<Task>;
  /** One-tap unblock — caller wires this to the existing status mutation. */
  onUnblock: (taskId: string) => void;
  /** Nudge to pin a task for today (caller routes to /projects). */
  onPinPrompt: () => void;
}) {
  const { t, i18n } = useTranslation();

  // Read "dismissed for today" on mount and re-check at midnight rollovers
  // implicitly via the stamp. We compute the stamp once per render; a session
  // crossing midnight is rare enough that a stale stamp self-corrects on the
  // next state-driven re-render (which /now gets on every WS event tick).
  const stamp = localDayStamp();
  const [dismissed, setDismissed] = useState<boolean>(() =>
    isDailyDismissed(stamp)
  );

  // Re-sync the dismissed flag if the day rolled over while mounted, and GC
  // yesterday's keys so storage stays one-entry-deep.
  useEffect(() => {
    setDismissed(isDailyDismissed(stamp));
    pruneStaleDismissKeys(stamp);
  }, [stamp]);

  if (dismissed) return null;

  const data = deriveDailyCheckin(allTasks, focused, blocked);
  if (!data.hasAnything) return null;

  function handleDismiss() {
    dismissDaily(stamp);
    setDismissed(true);
  }

  const weekday = new Date().toLocaleDateString(i18n.language, {
    weekday: 'long',
  });

  // --- Yesterday line (skipped when nothing moved) ---
  const { movement } = data;
  let yesterdayText: string | null = null;
  if (movement) {
    const { toDoing, toDone, toBlocked } = movement;
    const moved = (toDoing > 0 ? 1 : 0) + (toDone > 0 ? 1 : 0) + (toBlocked > 0 ? 1 : 0);
    if (moved >= 2) {
      yesterdayText = t('now.briefing.movedSummary', { toDoing, toDone, toBlocked });
    } else if (toDone > 0) {
      yesterdayText = t('now.briefing.movedDoneOnly', { n: toDone });
    } else if (toDoing > 0) {
      yesterdayText = t('now.briefing.movedDoingOnly', { n: toDoing });
    } else if (toBlocked > 0) {
      yesterdayText = t('now.briefing.movedBlockedOnly', { n: toBlocked });
    }
    // When nothing was bucketed but a finish was recorded, lean on the
    // shipped title alone.
    if (!yesterdayText && movement.lastShippedTitle) {
      yesterdayText = t('now.briefing.lastShipped', {
        title: movement.lastShippedTitle,
      });
    } else if (yesterdayText && movement.lastShippedTitle && toDone > 0) {
      yesterdayText = `${yesterdayText} · ${t('now.briefing.lastShipped', {
        title: movement.lastShippedTitle,
      })}`;
    }
  }

  // --- Today line ---
  const todayText =
    data.focusedCount === 0
      ? null
      : data.focusedCount === 1 && data.focusedLeadTitle
        ? data.focusedLeadTitle
        : t('now.dailyCheckin.pinnedCount', { n: data.focusedCount });

  // --- Blocked line ---
  const blockedCount = data.blocked.length;
  const loneBlocked = blockedCount === 1 ? data.blocked[0] : null;
  const blockedText =
    blockedCount === 0
      ? null
      : loneBlocked
        ? loneBlocked.title
        : t('now.dailyCheckin.blockedCount', { n: blockedCount });

  return (
    <section
      className="rd-briefing"
      role="region"
      aria-label={t('now.dailyCheckin.title')}
    >
      <button
        type="button"
        className="rd-briefing-close"
        onClick={handleDismiss}
        title={t('now.dailyCheckin.dismiss')}
        aria-label={t('now.dailyCheckin.dismiss')}
      >
        ×
      </button>
      <div className="rd-briefing-eyebrow">
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--focus)',
          }}
          aria-hidden="true"
        />
        {t('now.dailyCheckin.title')} · {weekday}
      </div>
      <h2>{t('now.dailyCheckin.headline')}</h2>

      <div className="rd-briefing-grid">
        <div className="rd-briefing-cell">
          <div className="rd-lbl">{t('now.dailyCheckin.yesterday')}</div>
          <div className="rd-val">
            {yesterdayText ?? t('now.dailyCheckin.yesterdayQuiet')}
          </div>
        </div>

        <div className="rd-briefing-cell">
          <div className="rd-lbl">{t('now.dailyCheckin.today')}</div>
          <div className="rd-val">
            {todayText ?? t('now.dailyCheckin.todayNone')}
          </div>
        </div>

        <div className="rd-briefing-cell">
          <div className="rd-lbl">{t('now.dailyCheckin.blockers')}</div>
          <div className="rd-val">
            {blockedText ?? t('now.dailyCheckin.blockersNone')}
          </div>
        </div>
      </div>

      <div className="rd-briefing-actions">
        {loneBlocked && (
          <button
            type="button"
            className="rd-btn rd-btn-primary rd-btn-sm"
            onClick={() => onUnblock(loneBlocked.id)}
          >
            {t('now.dailyCheckin.unblockCta')}
          </button>
        )}
        {data.focusedCount === 0 && (
          <button
            type="button"
            className="rd-btn rd-btn-ghost rd-btn-sm"
            onClick={onPinPrompt}
          >
            {t('now.dailyCheckin.pinCta')}
          </button>
        )}
        <button
          type="button"
          className="rd-btn rd-btn-ghost rd-btn-sm"
          onClick={handleDismiss}
        >
          {t('now.dailyCheckin.dismiss')}
        </button>
      </div>
    </section>
  );
}
