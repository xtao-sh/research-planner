import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task, ScheduleResult, Note } from '@rp/shared';
import { StaleBadge } from '../features/tasks/StaleBadge';

interface ReviewReportProps {
  tasks: Task[];
  schedule: ScheduleResult | null;
  projectName: string;
  /** Notes captured for this project (Phase C). Optional for callers that don't have them yet. */
  notes?: Note[];
  onAddTask?: () => void;
}

type ReportPeriod = 'week' | 'month' | 'all';

/**
 * Phase I — Progress retrospective.
 *
 * Reframes the old "Review Report" away from completion-rate / velocity
 * dashboards and toward a reflective retrospective: what shipped, what's still
 * in progress, what's stuck, what got captured, and three reflection prompts.
 */
export function ReviewReport({
  tasks,
  schedule,
  projectName,
  notes,
  onAddTask,
}: ReviewReportProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<ReportPeriod>('week');

  const data = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case 'week':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 30);
        break;
      case 'all':
        startDate = new Date(0);
        break;
    }
    const endDate = now;

    // Tasks completed (status=done). For the period filter we look at
    // updatedAt as a proxy for completion time when available.
    const tasksCompleted = tasks.filter((task) => {
      if (task.status !== 'done') return false;
      if (period === 'all') return true;
      const ts = task.updatedAt ? new Date(task.updatedAt).getTime() : NaN;
      if (Number.isNaN(ts)) return true;
      return ts >= startDate.getTime() && ts <= endDate.getTime();
    });

    const tasksInProgress = tasks.filter((task) => task.status === 'doing');
    const tasksBlocked = tasks.filter((task) => task.status === 'blocked');

    // Tasks past their hard deadline that aren't done — surface alongside blocked.
    const tasksPastDeadline = tasks.filter((task) => {
      if (task.status === 'done') return false;
      if (!task.dueHard) return false;
      return new Date(task.dueHard).getTime() < now.getTime();
    });

    // Plus tasks scheduled to end before "now" but still not done.
    if (schedule) {
      schedule.items.forEach((item) => {
        const task = tasks.find((x) => x.id === item.taskId);
        if (!task || task.status === 'done') return;
        const endTime = new Date(item.endPlanned).getTime();
        if (endTime < now.getTime() && !tasksPastDeadline.find((d) => d.id === task.id)) {
          tasksPastDeadline.push(task);
        }
      });
    }

    // Merge blocked + past-deadline into the "stuck" bucket, dedup by id.
    const stuckMap = new Map<string, { task: Task; reason: 'blocked' | 'pastDeadline' }>();
    tasksBlocked.forEach((task) => stuckMap.set(task.id, { task, reason: 'blocked' }));
    tasksPastDeadline.forEach((task) => {
      if (!stuckMap.has(task.id)) {
        stuckMap.set(task.id, { task, reason: 'pastDeadline' });
      }
    });
    const stuck = Array.from(stuckMap.values());

    // Notes captured during the period.
    const notesInPeriod = (notes ?? []).filter((note) => {
      if (period === 'all') return true;
      const ts = new Date(note.createdAt).getTime();
      return ts >= startDate.getTime() && ts <= endDate.getTime();
    });

    return {
      startDate,
      endDate,
      tasksCompleted,
      tasksInProgress,
      stuck,
      notesInPeriod,
    };
  }, [tasks, schedule, notes, period]);

  const formatDate = (date: Date) =>
    date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  const formatDateTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  };

  const sizeBadge = (task: Task): string => {
    const m = task.estimate?.m ?? 0;
    if (m <= 2) return 'S';
    if (m <= 8) return 'M';
    if (m <= 24) return 'L';
    return 'XL';
  };

  const previewBody = (body: string, maxChars = 160): string => {
    const trimmed = body.trim().replace(/\s+/g, ' ');
    if (trimmed.length <= maxChars) return trimmed;
    return trimmed.slice(0, maxChars).trimEnd() + '…';
  };

  return (
    <div className="review-report-container">
      <div className="review-report-header">
        <div>
          <h3>{t('review.panel')}</h3>
          <p className="review-report-subtitle">{projectName}</p>
        </div>
        <div className="review-period-selector">
          <button
            className={`period-btn ${period === 'week' ? 'active' : ''}`}
            onClick={() => setPeriod('week')}
          >
            {t('review.periodWeek')}
          </button>
          <button
            className={`period-btn ${period === 'month' ? 'active' : ''}`}
            onClick={() => setPeriod('month')}
          >
            {t('review.periodMonth')}
          </button>
          <button
            className={`period-btn ${period === 'all' ? 'active' : ''}`}
            onClick={() => setPeriod('all')}
          >
            {t('review.periodAll')}
          </button>
        </div>
      </div>

      <div className="review-report-period">
        <strong>{t('review.periodRange')}</strong>{' '}
        {formatDate(data.startDate)} – {formatDate(data.endDate)}
      </div>

      {tasks.length === 0 ? (
        <section className="review-section">
          <div className="empty-state-card">
            <div className="empty-state-card-icon">🎯</div>
            <div className="empty-state-card-title">
              {t('dashboard.emptyTitle')}
            </div>
            <div className="empty-state-card-subtitle">
              {t('dashboard.emptySubtitle')}
            </div>
            {onAddTask && (
              <button type="button" className="btn-primary" onClick={onAddTask}>
                {t('dashboard.emptyCta')}
              </button>
            )}
          </div>
        </section>
      ) : (
        <>
          {/* One neutral count line, replacing the completion-rate dashboard. */}
          <section className="review-section">
            <p className="review-completed-summary">
              {t('review.completedSummary', {
                count: data.tasksCompleted.length,
              })}
            </p>
          </section>

          {/* What shipped */}
          <section className="review-section">
            <h4>{t('review.shipped.title')}</h4>
            {data.tasksCompleted.length === 0 ? (
              <p className="review-empty">{t('review.shipped.empty')}</p>
            ) : (
              <ul className="review-task-list">
                {data.tasksCompleted.map((task) => (
                  <li key={task.id} className="review-task-item">
                    <span className="task-title">{task.title}</span>
                    <span className="task-size-badge">{sizeBadge(task)}</span>
                    {task.updatedAt && (
                      <span className="task-finished-at">
                        {formatDateTime(task.updatedAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* In progress */}
          <section className="review-section">
            <h4>{t('review.inProgress.title')}</h4>
            {data.tasksInProgress.length === 0 ? (
              <p className="review-empty">{t('review.inProgress.empty')}</p>
            ) : (
              <ul className="review-task-list">
                {data.tasksInProgress.map((task) => (
                  <li key={task.id} className="review-task-item">
                    <span className="task-title">{task.title}</span>
                    <span className="task-size-badge">{sizeBadge(task)}</span>
                    <StaleBadge task={task} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Stuck */}
          <section className="review-section">
            <h4>{t('review.stuck.title')}</h4>
            {data.stuck.length === 0 ? (
              <p className="review-empty">{t('review.stuck.empty')}</p>
            ) : (
              <ul className="review-task-list">
                {data.stuck.map(({ task, reason }) => (
                  <li key={task.id} className="review-task-item blocked">
                    <span className="task-title">{task.title}</span>
                    <span className="task-size-badge">{sizeBadge(task)}</span>
                    {reason === 'pastDeadline' && (
                      <span className="task-status">
                        {t('review.stuckPastDeadline')}
                      </span>
                    )}
                    <StaleBadge task={task} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Notes captured */}
          <section className="review-section">
            <h4>{t('review.notes.title')}</h4>
            {data.notesInPeriod.length === 0 ? (
              <p className="review-empty">{t('review.notes.empty')}</p>
            ) : (
              <>
                <p className="review-notes-count">
                  {t('review.notes.count', {
                    count: data.notesInPeriod.length,
                  })}
                </p>
                <ul className="review-notes-preview">
                  {[...data.notesInPeriod]
                    .sort(
                      (a, b) =>
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime()
                    )
                    .slice(0, 3)
                    .map((note) => (
                      <li key={note.id} className="review-note-preview">
                        {previewBody(note.body)}
                      </li>
                    ))}
                </ul>
              </>
            )}
          </section>

          {/* Reflection prompts — invitations to think, no auto-answers. */}
          <section className="review-section">
            <h4>{t('review.reflection.title')}</h4>
            <ul className="review-reflection-prompts">
              <li>{t('review.reflection.prompt1')}</li>
              <li>{t('review.reflection.prompt2')}</li>
              <li>{t('review.reflection.prompt3')}</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
