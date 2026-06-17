import React, { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProjectMode, ProjectType } from '@rp/shared';
import { sendJson } from '../../api/client';
import { useAppData } from '../../contexts/AppDataContext';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { WorkspaceSwitcher } from '../workspaces/WorkspaceSwitcher';
import { canWrite as canWriteRole } from '../workspaces/permissions';
import { PresenceBar } from '../presence/PresenceBar';
import { isActiveWorkspaceSolo } from '../workspaces/isSolo';
import { PROJECT_TYPES } from '../projects/projectTypes';
import { PROJECT_MODES } from '../projects/projectMode';
import { NavLink } from 'react-router-dom';
import { QuickCaptureModal } from '../capture/QuickCaptureModal';
import { ShortcutsHelpModal } from '../help/ShortcutsHelpModal';
import { CommandPalette } from '../command/CommandPalette';
import { useToast } from '../../components/Toast';

export function AppLayout() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const {
    auth,
    workspaces,
    projects,
    presenceMembers,
    wsConnected,
    wsLastError,
    refreshProjects,
    setActiveProjectId,
  } = useAppData();
  // Multi-user mode toggles workspace switcher / presence / WS-status chrome.
  // Reported by /api/auth/me; defaults to false in solo local mode.
  const isMultiUserMode = auth.user?.multiUser === true;

  const activeWorkspaceRole = workspaces.workspaces.find(
    (w) => w.id === workspaces.activeWorkspaceId
  )?.role;
  const canWriteActiveWorkspace = canWriteRole(activeWorkspaceRole);
  const isSolo = isActiveWorkspaceSolo(
    workspaces.workspaces,
    workspaces.activeWorkspaceId
  );

  const [showCapture, setShowCapture] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  // Mobile drawer state — below 900px the sidebar is hidden by default and
  // slides in when this is true. Closed automatically on Esc and on every
  // route change so navigation doesn't leave it open.
  const [mobileOpen, setMobileOpen] = useState(false);

  // Theme toggle — boot script in index.html sets the initial value
  // synchronously to avoid a flash of light mode. We mirror it into React
  // state so the icon stays in sync with the current theme.
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'dark'
      ? 'dark'
      : 'light'
  );
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('rp.theme', theme);
    } catch {
      /* localStorage may be blocked */
    }
  }, [theme]);

  // Derive defaultProjectId for quick-capture from the URL when we're on a
  // project detail page. Reading via useLocation() avoids context plumbing.
  const location = useLocation();
  const captureDefaultProjectId = (() => {
    const m = location.pathname.match(/^\/projects\/([^/]+)$/);
    return m ? m[1] : null;
  })();

  // Mobile drawer: close on Esc.
  React.useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Mobile drawer: auto-close after a route change.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Global hotkeys.
  // * Cmd/Ctrl+Shift+N -> quick-capture (existing)
  // * '?'              -> shortcuts modal (existing)
  // * Cmd/Ctrl+K       -> toggle the command palette (new)
  // The palette has its own onKeyDown for ↑/↓/Enter/Esc; while it's open we
  // also keep ⌘K functional (close-on-toggle), but suppress the other globals
  // so ? typed inside the palette input doesn't open the shortcuts modal —
  // and the palette input itself stops propagation through isEditableTarget.
  React.useEffect(() => {
    function isEditableTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      if (t.isContentEditable) return true;
      const tag = t.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    }
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;

      // ⌘K / Ctrl+K — toggle palette. Highest priority so it works from
      // any focus context, including text inputs.
      if (cmd && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }

      // '?' (no modifier) opens the shortcuts modal when not in an input.
      if (
        e.key === '?' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isEditableTarget(e.target)
      ) {
        e.preventDefault();
        setShowShortcutsHelp(true);
        return;
      }
      if (!cmd || !e.shiftKey) return;
      if (e.key.toLowerCase() !== 'n') return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      setShowCapture(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectType, setNewProjectType] = useState<ProjectType>('other');
  const [newProjectMode, setNewProjectMode] = useState<ProjectMode>('progress');
  const [creatingProject, setCreatingProject] = useState(false);

  const openNewProject = () => setShowNewProjectDialog(true);

  // Expose `openNewProject` and `openCapture` on custom events so child
  // pages/components can call them without prop-drilling — keeps the
  // layout API tiny.
  React.useEffect(() => {
    const newProj = () => openNewProject();
    const openCap = () => setShowCapture(true);
    window.addEventListener('rp:new-project', newProj);
    window.addEventListener('rp:open-capture', openCap);
    return () => {
      window.removeEventListener('rp:new-project', newProj);
      window.removeEventListener('rp:open-capture', openCap);
    };
  }, []);

  const handleSelectPresenceProject = (pid: string) => {
    if (projects.find((p) => p.id === pid)) {
      setActiveProjectId(pid);
      navigate(`/projects/${pid}`);
    }
  };

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) {
      toast.push(t('project.nameRequired'), { kind: 'warning' });
      return;
    }
    try {
      setCreatingProject(true);
      const res = await sendJson('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: newProjectDescription.trim(),
          type: newProjectType,
          mode: newProjectMode,
          ...(workspaces.activeWorkspaceId
            ? { workspaceId: workspaces.activeWorkspaceId }
            : {}),
        }),
      });
      const created = await res.json();
      await refreshProjects();
      setShowNewProjectDialog(false);
      setNewProjectName('');
      setNewProjectDescription('');
      setNewProjectType('other');
      setNewProjectMode('progress');
      navigate(`/projects/${created.id}`);
    } catch (e: any) {
      toast.push(`${t('project.createFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
    } finally {
      setCreatingProject(false);
    }
  }

  // Sidebar nav items. Glyphs are unicode marks chosen to match the
  // redesign's iconography without a separate icon library.
  const navItems = [
    { to: '/now', key: 'now' as const, glyph: '●' },
    { to: '/inbox', key: 'inbox' as const, glyph: '↓' },
    { to: '/projects', key: 'projects' as const, glyph: '▦' },
    { to: '/review', key: 'review' as const, glyph: '◔' },
    { to: '/search', key: 'search' as const, glyph: '⌕' },
  ];

  // Pinned projects in sidebar — first 4 active. The redesign surfaces
  // these prominently so deep-link to a project is one click away.
  const pinnedProjects = projects.slice(0, 4);

  // User chip — derive initials from display name or email.
  const userInitials = (() => {
    const u = auth.user;
    if (!u) return '?';
    const name = u.name || u.email || '';
    const parts = name.split(/[\s@.]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  })();
  const userDisplayName = auth.user?.name || auth.user?.email?.split('@')[0] || 'You';

  return (
    <div
      className="app-shell"
      data-mobile-open={mobileOpen ? 'true' : undefined}
    >
      <button
        type="button"
        className="app-shell-mobile-toggle"
        aria-label={t('nav.toggleSidebar')}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((o) => !o)}
      >
        ☰
      </button>
      <div
        className="app-shell-mobile-backdrop"
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />
      <aside className="app-shell-sidebar" aria-label={t("nav.sidebarLandmark")}>
        {/* Brand cluster — icon tile + name + sub. The same SVG as the
            favicon and the install/dock icon, so the brand reads
            consistently across tab, dock, and in-app surfaces. */}
        <div className="rd-brand">
          <img
            src="/icon.svg"
            alt=""
            aria-hidden="true"
            className="rd-brand-mark"
          />
          <div>
            <div className="rd-brand-name">{t('app.title')}</div>
            <div className="rd-brand-sub">{t('app.tagline')}</div>
          </div>
        </div>

        {/* Capture button — primary CTA in the sidebar, with kbd hint. */}
        <button
          type="button"
          className="rd-capture-btn"
          onClick={() => setShowCapture(true)}
          title={t('capture.openHotkeyHint')}
        >
          <span style={{ fontSize: 14 }}>＋</span>
          <span>{t('capture.openButton')}</span>
          <span className="rd-kbd">⌘⇧N</span>
        </button>

        {/* Primary nav. NavLink handles the active class via isActive. */}
        <nav className="rd-nav-group" aria-label={t("nav.primaryNav")}>
          {navItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                isActive ? 'rd-nav-item active' : 'rd-nav-item'
              }
            >
              <span className="rd-glyph" aria-hidden="true">{it.glyph}</span>
              <span>{t(`nav.${it.key}` as const)}</span>
            </NavLink>
          ))}
        </nav>

        {/* Pinned projects — quick access without going to the gallery. */}
        {pinnedProjects.length > 0 && (
          <div className="rd-nav-group">
            <div className="rd-nav-group-label">{t('nav.pinnedProjects')}</div>
            {pinnedProjects.map((p) => (
              <NavLink
                key={p.id}
                to={`/projects/${p.id}`}
                className={({ isActive }) =>
                  isActive ? 'rd-nav-item active' : 'rd-nav-item'
                }
              >
                <span
                  className="rd-pdot"
                  style={{ background: `var(--type-${p.type})` }}
                  aria-hidden="true"
                />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.name}
                </span>
              </NavLink>
            ))}
          </div>
        )}

        {/* Bottom-pinned action chrome: language switcher, help, multi-user
            workspace switcher / presence / WS-status, then user chip. */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
            <LanguageSwitcher />
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label={t('app.toggleTheme')}
                title={t('app.toggleTheme')}
                className="rd-icon-btn"
              >
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/settings')}
                aria-label={t('nav.settings')}
                title={t('nav.settings')}
                className="rd-icon-btn"
              >
                ⚙
              </button>
              <button
                type="button"
                onClick={() => setShowShortcutsHelp(true)}
                aria-label={t('shortcuts.open')}
                title={t('shortcuts.open')}
                className="masthead-help-btn"
              >
                ?
              </button>
            </div>
          </div>
          {isMultiUserMode && (
            <WorkspaceSwitcher
              workspaces={workspaces.workspaces}
              activeWorkspaceId={workspaces.activeWorkspaceId}
              onSelect={workspaces.setActiveWorkspaceId}
              onCreate={workspaces.createAndActivate}
              currentUserId={auth.user?.id ?? null}
              onMembershipChanged={() => void workspaces.refresh()}
              isSolo={isSolo}
            />
          )}
          {isMultiUserMode && !isSolo && (
            <PresenceBar
              members={presenceMembers}
              currentUserId={auth.user?.id ?? null}
              projects={projects}
              onSelectProject={handleSelectPresenceProject}
            />
          )}
          <div className="rd-user-chip">
            <div className="rd-avatar">{userInitials}</div>
            <div style={{ minWidth: 0 }}>
              <div
                className="rd-user-name"
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {userDisplayName}
              </div>
              <div className="rd-user-sub">
                {isMultiUserMode && !isSolo
                  ? t('workspace.shared')
                  : t('workspace.solo')}
                {isMultiUserMode && !isSolo && (
                  <span
                    aria-label={
                      wsLastError === 'unauthorized'
                        ? t('realtime.unauthorized')
                        : wsConnected
                        ? t('realtime.connected')
                        : t('realtime.disconnected')
                    }
                    title={
                      wsLastError === 'unauthorized'
                        ? t('realtime.unauthorized')
                        : wsConnected
                        ? t('realtime.connected')
                        : t('realtime.disconnected')
                    }
                    style={{
                      display: 'inline-block',
                      marginLeft: 6,
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background:
                        wsLastError === 'unauthorized'
                          ? '#ef4444'
                          : wsConnected
                          ? '#22c55e'
                          : '#9ca3af',
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* When the mobile sidebar drawer is open, make <main> inert so Tab
          can't escape the drawer and so the obscured route content is
          hidden from assistive tech. The `inert` attribute is set via a
          spread to satisfy React's typing (it landed in React 19; our
          types may not have it yet). */}
      <main
        className="app-shell-main"
        aria-hidden={mobileOpen || undefined}
        {...(mobileOpen ? { inert: '' } : {})}
      >
        <Outlet />
      </main>

      <QuickCaptureModal
        open={showCapture}
        defaultProjectId={captureDefaultProjectId}
        onClose={() => setShowCapture(false)}
      />

      <ShortcutsHelpModal
        open={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />

      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
      />

      {showNewProjectDialog && (
        <div
          className="modal-overlay"
          onClick={() => setShowNewProjectDialog(false)}
        >
          <div
            className="modal-content new-project-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{t('project.newProject.title')}</h3>
              <button
                className="modal-close"
                onClick={() => setShowNewProjectDialog(false)}
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>
            <div className="form-group">
              <label>
                {t('project.newProject.name')}{' '}
                <span className="form-required">
                  {t('project.newProject.nameRequired')}
                </span>
              </label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder={t('project.newProject.namePlaceholder')}
                autoFocus
              />
              <p className="form-hint">{t('project.newProject.hint')}</p>
            </div>
            <div className="form-group">
              <label>{t('project.newProject.description')}</label>
              <textarea
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                placeholder={t('project.newProject.descriptionPlaceholder')}
                rows={4}
              />
            </div>
            <div className="form-group">
              <label>{t('project.newProject.type')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {PROJECT_TYPES.map((meta) => {
                  const selected = newProjectType === meta.type;
                  return (
                    <button
                      type="button"
                      key={meta.type}
                      onClick={() => setNewProjectType(meta.type)}
                      className={
                        selected ? 'type-pill type-pill-selected' : 'type-pill'
                      }
                    >
                      {t(meta.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="form-group">
              <label>{t('project.mode.label')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {PROJECT_MODES.map((m) => {
                  const selected = newProjectMode === m.mode;
                  return (
                    <button
                      type="button"
                      key={m.mode}
                      onClick={() => setNewProjectMode(m.mode)}
                      className={
                        selected ? 'type-pill type-pill-selected' : 'type-pill'
                      }
                      title={t(
                        m.hintKey as
                          | 'project.mode.progressHint'
                          | 'project.mode.deadlineHint'
                      )}
                    >
                      {t(
                        m.labelKey as
                          | 'project.mode.progress'
                          | 'project.mode.deadline'
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="form-hint">
                {t(
                  newProjectMode === 'progress'
                    ? 'project.mode.progressHint'
                    : 'project.mode.deadlineHint'
                )}
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowNewProjectDialog(false)}
                disabled={creatingProject}
              >
                {t('project.newProject.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleCreateProject}
                disabled={
                  creatingProject ||
                  !newProjectName.trim() ||
                  !canWriteActiveWorkspace
                }
              >
                {creatingProject
                  ? t('project.newProject.creating')
                  : t('project.newProject.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

