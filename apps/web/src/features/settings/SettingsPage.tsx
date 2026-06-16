import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import { CalendarPanel } from '../calendar/CalendarPanel';
import { canWrite as canWriteRole } from '../workspaces/permissions';
import {
  STATUS_KEYS,
  type WipLimits,
  getIntensityBudget,
  getWipLimits,
  setIntensityBudget,
  setWipLimits,
} from './settingsStore';

type Tab = 'workspace' | 'projects';

/**
 * Settings page — local-only v1. Two tabs:
 *   1. Workspace — daily intensity-points budget (drives /now CapacityRail).
 *   2. Projects — per-project WIP limits per status column.
 *
 * All values persist to localStorage via settingsStore. A change event
 * (`rp:settings-changed`) fires after each save so subscribed surfaces
 * (CapacityRail, KanbanView via ProjectDetailPage) refresh without props.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { projects } = useAppData();
  const [tab, setTab] = useState<Tab>('workspace');

  return (
    <>
      <div className="rd-topbar">
        <h1>{t('settings.title')}</h1>
        <span className="rd-spacer" />
      </div>
      <div className="rd-page">
        <nav
          className="rd-tabs"
          role="tablist"
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--rd-line)',
            marginBottom: 16,
          }}
        >
          <TabButton
            active={tab === 'workspace'}
            label={t('settings.workspace')}
            onClick={() => setTab('workspace')}
          />
          <TabButton
            active={tab === 'projects'}
            label={t('settings.projects')}
            onClick={() => setTab('projects')}
          />
        </nav>

        {tab === 'workspace' ? (
          <WorkspaceTab />
        ) : (
          <ProjectsTab projects={projects} />
        )}
      </div>
    </>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={active ? 'rd-tab active' : 'rd-tab'}
      style={{
        padding: '8px 14px',
        background: 'transparent',
        border: 'none',
        borderBottom: active
          ? '2px solid var(--accent)'
          : '2px solid transparent',
        cursor: 'pointer',
        color: active ? 'var(--rd-ink)' : 'var(--rd-ink-3)',
        fontWeight: active ? 600 : 500,
        fontSize: 13,
      }}
    >
      {label}
    </button>
  );
}

function WorkspaceTab() {
  const { t } = useTranslation();
  const { activeWorkspaceId, workspaces } = useAppData();
  const [budget, setBudgetLocal] = useState<number>(() => getIntensityBudget());
  const [savedFlash, setSavedFlash] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  // The working calendar is per-workspace and drives every schedule. Its
  // editor (CalendarPanel) existed but was never mounted anywhere — so
  // users couldn't set the calendar the scheduler depends on. Surface it
  // here.
  const activeRole = workspaces.workspaces.find(
    (w) => w.id === activeWorkspaceId
  )?.role;
  const canEditCalendar = canWriteRole(activeRole);

  function handleSave() {
    setIntensityBudget(budget);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1400);
  }

  const dirty = budget !== getIntensityBudget();

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="rd-section-eyebrow">{t('settings.workspace')}</div>
      <div style={{ maxWidth: 480 }}>
        <label
          htmlFor="rp-intensity-budget"
          style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}
        >
          {t('settings.intensityBudget')}
        </label>
        <input
          id="rp-intensity-budget"
          type="number"
          min={1}
          max={15}
          step={1}
          value={budget}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setBudgetLocal(Math.max(1, Math.min(15, Math.floor(n))));
          }}
          style={{
            width: 96,
            padding: '6px 10px',
            border: '1px solid var(--rd-line)',
            borderRadius: 6,
            fontSize: 14,
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        <p
          className="muted"
          style={{ fontSize: 12, marginTop: 8, color: 'var(--rd-ink-3)' }}
        >
          {t('settings.intensityBudgetHint')}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className="rd-btn rd-btn-primary"
          onClick={handleSave}
          disabled={!dirty}
        >
          {t('settings.save')}
        </button>
        {savedFlash && (
          <span style={{ fontSize: 12, color: 'var(--rd-ink-3)' }}>
            {t('settings.saved')}
          </span>
        )}
      </div>

      <div style={{ maxWidth: 480, marginTop: 8 }}>
        <label
          style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}
        >
          {t('settings.workingCalendar')}
        </label>
        <p
          className="muted"
          style={{ fontSize: 12, marginTop: 0, marginBottom: 8, color: 'var(--rd-ink-3)' }}
        >
          {t('settings.workingCalendarHint')}
        </p>
        <button
          type="button"
          className="rd-btn rd-btn-sm"
          onClick={() => setShowCalendar(true)}
          disabled={!activeWorkspaceId}
        >
          {t('settings.editWorkingCalendar')}
        </button>
      </div>

      {showCalendar && activeWorkspaceId && (
        <CalendarPanel
          workspaceId={activeWorkspaceId}
          canEdit={canEditCalendar}
          onClose={() => setShowCalendar(false)}
        />
      )}
    </section>
  );
}

function ProjectsTab({ projects }: { projects: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  if (projects.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        {/* Reuse the existing topOfMindEmpty-ish messaging — but settings has
            no dedicated empty key, so a plain hint suffices. */}
        —
      </p>
    );
  }
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="rd-section-eyebrow">{t('settings.projects')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {projects.map((p) => (
          <ProjectRow key={p.id} projectId={p.id} projectName={p.name} />
        ))}
      </div>
    </section>
  );
}

function ProjectRow({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const initial = useMemo<WipLimits>(() => getWipLimits(projectId), [projectId]);
  // Mirror as string state so the empty-input UX (clear field => "no limit")
  // is straightforward; we coerce to numbers in handleSave.
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const k of STATUS_KEYS) {
      const v = initial[k];
      out[k] = typeof v === 'number' && v > 0 ? String(v) : '';
    }
    return out;
  });
  const [savedFlash, setSavedFlash] = useState(false);

  function handleSave() {
    const limits: WipLimits = {};
    for (const k of STATUS_KEYS) {
      const raw = draft[k];
      if (!raw || !raw.trim()) continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) limits[k] = Math.floor(n);
    }
    setWipLimits(projectId, limits);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1400);
  }

  return (
    <div
      style={{
        border: '1px solid var(--rd-line)',
        borderRadius: 8,
        padding: '8px 12px',
        background: 'var(--rd-surface)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          padding: 0,
          textAlign: 'left',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--rd-ink)',
        }}
        aria-expanded={open}
      >
        <span style={{ width: 12, fontSize: 11, color: 'var(--rd-ink-3)' }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {projectName}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              gap: 8,
            }}
          >
            {STATUS_KEYS.map((status) => (
              <ColumnLimitInput
                key={status}
                status={status}
                value={draft[status]}
                onChange={(v) => setDraft((d) => ({ ...d, [status]: v }))}
                noLimitLabel={t('settings.noLimit')}
                wipLabel={t('settings.wipLimit')}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="rd-btn rd-btn-primary rd-btn-sm"
              onClick={handleSave}
            >
              {t('settings.save')}
            </button>
            {savedFlash && (
              <span style={{ fontSize: 12, color: 'var(--rd-ink-3)' }}>
                {t('settings.saved')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ColumnLimitInput({
  status,
  value,
  onChange,
  noLimitLabel,
  wipLabel,
}: {
  status: Task['status'];
  value: string;
  onChange: (v: string) => void;
  noLimitLabel: string;
  wipLabel: string;
}) {
  const { t } = useTranslation();
  const statusLabel = t(`task.statusLabels.${status}` as const);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--rd-ink-3)',
        }}
      >
        {statusLabel}
      </label>
      <input
        type="number"
        min={1}
        step={1}
        value={value}
        placeholder={noLimitLabel}
        aria-label={`${statusLabel} ${wipLabel}`}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '5px 8px',
          border: '1px solid var(--rd-line)',
          borderRadius: 6,
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    </div>
  );
}
