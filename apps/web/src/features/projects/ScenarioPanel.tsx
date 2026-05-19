import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Scenario, ScheduleResult } from '@rp/shared';
import type { DurationMode } from '@rp/scheduler';
import {
  createScenario,
  deleteScenario,
  getProjectScenarios,
} from '../../api/scenarios';
import { useToast } from '../../components/Toast';

/**
 * ScenarioPanel — compact "save + compare" affordance for the deadline-mode
 * schedule view. Saved scenarios are snapshots of a previous schedule run; the
 * user can mark one as the active comparison and the parent renders it as a
 * ghost overlay on the lane / Gantt.
 *
 * Single-active comparison: clicking "compare" on a different scenario
 * toggles the previous off. Clicking the active one again deactivates it.
 */
interface ScenarioPanelProps {
  projectId: string;
  durationMode: DurationMode;
  /** Active comparison scenario id; setting it shows the overlay. */
  activeScenarioId: string | null;
  onActiveChange: (
    id: string | null,
    snapshot: ScheduleResult | null,
    name: string | null
  ) => void;
  /** Bumped when parent wants the panel to refetch (e.g. after saving). */
  refreshTrigger?: number;
}

function relativeTimestamp(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  // Fall back to short date for older items.
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function modeBadge(mode: Scenario['durationMode']): string {
  if (mode === 'optimistic') return 'O';
  if (mode === 'pessimistic') return 'P';
  return 'PERT';
}

export function ScenarioPanel({
  projectId,
  durationMode,
  activeScenarioId,
  onActiveChange,
  refreshTrigger,
}: ScenarioPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const list = await getProjectScenarios(projectId);
      setScenarios(list);
    } catch {
      // Silent failure — the empty-list state covers it.
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
  }, [refetch, refreshTrigger]);

  // If the active scenario is deleted out from under us, drop the overlay.
  useEffect(() => {
    if (!activeScenarioId) return;
    if (!scenarios.some((s) => s.id === activeScenarioId)) {
      onActiveChange(null, null, null);
    }
  }, [activeScenarioId, scenarios, onActiveChange]);

  const handleSave = useCallback(async () => {
    const name = window.prompt(t('schedule.scenarioNamePrompt'));
    if (!name || !name.trim()) return;
    setSaving(true);
    try {
      await createScenario(projectId, {
        name: name.trim(),
        durationMode,
      });
      await refetch();
    } catch {
      toast.push(t('schedule.saveScenarioFailed'), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  }, [projectId, durationMode, refetch, t]);

  const handleDelete = useCallback(
    async (s: Scenario) => {
      if (!window.confirm(t('schedule.deleteScenario', { name: s.name }))) return;
      try {
        await deleteScenario(s.id);
        if (activeScenarioId === s.id) onActiveChange(null, null, null);
        await refetch();
      } catch {
        toast.push(t('schedule.deleteScenarioFailed'), { kind: 'error' });
      }
    },
    [t, activeScenarioId, onActiveChange, refetch]
  );

  const handleToggleCompare = useCallback(
    (s: Scenario) => {
      if (activeScenarioId === s.id) {
        onActiveChange(null, null, null);
      } else {
        onActiveChange(s.id, s.snapshot, s.name);
      }
    },
    [activeScenarioId, onActiveChange]
  );

  return (
    <div className="rd-scenario-panel">
      <div className="rd-scenario-head">
        <span className="rd-section-eyebrow">
          {t('schedule.scenarios', { count: scenarios.length })}
        </span>
        <button
          type="button"
          className="rd-btn rd-btn-sm"
          onClick={handleSave}
          disabled={saving}
        >
          + {t('schedule.saveScenario')}
        </button>
      </div>
      {scenarios.length === 0 ? (
        <div className="rd-scenario-empty">
          <div>{t('schedule.noScenarios')}</div>
          <div className="rd-scenario-empty-hint">
            Save the current schedule to compare against tomorrow&rsquo;s.
          </div>
        </div>
      ) : (
        <ul className="rd-scenario-list">
          {scenarios.map((s) => {
            const isActive = activeScenarioId === s.id;
            return (
              <li
                key={s.id}
                className="rd-scenario-row"
                data-active={isActive ? 'true' : 'false'}
              >
                <span className="rd-scenario-name" title={s.name}>
                  {s.name}
                </span>
                <span className="rd-scenario-mode" title={s.durationMode}>
                  {modeBadge(s.durationMode)}
                </span>
                <span className="rd-scenario-time">
                  {relativeTimestamp(s.createdAt)}
                </span>
                <button
                  type="button"
                  className={`rd-btn rd-btn-sm ${
                    isActive ? 'rd-btn-primary' : 'rd-btn-ghost'
                  }`}
                  onClick={() => handleToggleCompare(s)}
                  aria-pressed={isActive}
                  title={t('schedule.compareScenario', { name: s.name })}
                >
                  {isActive ? '●' : '○'}
                </button>
                <button
                  type="button"
                  className="rd-btn rd-btn-sm rd-btn-ghost rd-scenario-del"
                  onClick={() => handleDelete(s)}
                  title={t('schedule.deleteScenario', { name: s.name })}
                  aria-label={t('schedule.deleteScenario', { name: s.name })}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {loading && scenarios.length === 0 ? null : null}
    </div>
  );
}
