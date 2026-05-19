import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceSummary } from '../../api/workspaces';
import { MembersPanel } from './MembersPanel';
import { canManageMembers } from './permissions';

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<WorkspaceSummary>;
  currentUserId: string | null;
  onMembershipChanged?: () => void;
  /**
   * When the active workspace has a single member, swap the "Members" affordance
   * for a friendlier "+ Invite people" entry that opens the same panel. The
   * panel itself is unchanged; this only re-labels the trigger.
   */
  isSolo?: boolean;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onCreate,
  currentUserId,
  onMembershipChanged,
  isSolo = false,
}: WorkspaceSwitcherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId]
  );

  // Close menu on outside click.
  useEffect(() => {
    if (!open) return;
    function handleDocClick(ev: MouseEvent) {
      if (!rootRef.current) return;
      if (ev.target instanceof Node && rootRef.current.contains(ev.target)) return;
      setOpen(false);
      setShowCreateForm(false);
      setCreateError(null);
    }
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [open]);

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = newName.trim();
      if (!name) {
        setCreateError(t('workspace.nameRequired'));
        return;
      }
      setCreating(true);
      setCreateError(null);
      try {
        await onCreate(name);
        setNewName('');
        setShowCreateForm(false);
        setOpen(false);
      } catch (err) {
        setCreateError(
          err instanceof Error ? err.message : t('workspace.createFailed')
        );
      } finally {
        setCreating(false);
      }
    },
    [newName, onCreate, t]
  );

  const canManage = canManageMembers(active?.role);

  const buttonStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid var(--border-color, #ddd)',
    borderRadius: 4,
    padding: '0.2rem 0.6rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    maxWidth: 180,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const menuStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    minWidth: 240,
    background: 'var(--bg-secondary, #fff)',
    border: '1px solid var(--border-color, #ddd)',
    borderRadius: 6,
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
    zIndex: 20,
    padding: '0.25rem 0',
  };

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '0.4rem 0.75rem',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.85rem',
    textAlign: 'left',
    color: 'inherit',
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={buttonStyle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('workspace.switcher')}
      >
        {active ? active.name : t('workspace.title')} ▾
      </button>
      {open && (
        <div style={menuStyle} role="menu">
          {workspaces.length === 0 && (
            <div
              style={{
                padding: '0.4rem 0.75rem',
                fontSize: '0.85rem',
                color: 'var(--muted-color, #666)',
              }}
            >
              {t('common.none')}
            </div>
          )}
          {workspaces.map((w) => {
            const isActive = w.id === activeWorkspaceId;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  onSelect(w.id);
                  setOpen(false);
                }}
                style={{
                  ...itemStyle,
                  fontWeight: isActive ? 700 : 400,
                  background: isActive
                    ? 'var(--border-color, #eef1f5)'
                    : 'transparent',
                }}
                role="menuitem"
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {w.name}
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '1px 6px',
                    borderRadius: 8,
                    marginLeft: 6,
                    border: '1px solid var(--border-color, #ddd)',
                    color: 'var(--muted-color, #666)',
                  }}
                >
                  {t(`role.${w.role}`)}
                </span>
              </button>
            );
          })}
          <div
            style={{
              borderTop: '1px solid var(--border-color, #eee)',
              marginTop: 4,
              paddingTop: 4,
            }}
          />
          {active && (
            <button
              type="button"
              onClick={() => {
                setShowMembers(true);
                setOpen(false);
              }}
              style={
                isSolo
                  ? {
                      ...itemStyle,
                      fontSize: '0.78rem',
                      color: 'var(--muted-color, #666)',
                    }
                  : itemStyle
              }
              role="menuitem"
              title={isSolo ? t('workspace.soloHint') : undefined}
            >
              {isSolo
                ? t('workspace.invitePeople')
                : canManage
                ? t('workspace.manageMembers')
                : t('workspace.viewMembers')}
            </button>
          )}
          {!showCreateForm ? (
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              style={itemStyle}
              role="menuitem"
            >
              {t('workspace.newWorkspace')}
            </button>
          ) : (
            <form
              onSubmit={handleCreate}
              style={{
                padding: '0.4rem 0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('workspace.workspaceName')}
                style={{
                  padding: '0.3rem 0.4rem',
                  fontSize: '0.85rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: 4,
                }}
              />
              {createError && (
                <div
                  className="error-message"
                  style={{ fontSize: '0.75rem' }}
                >
                  {createError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewName('');
                    setCreateError(null);
                  }}
                  style={{
                    fontSize: '0.8rem',
                    padding: '0.2rem 0.6rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: 4,
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                  disabled={creating}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  style={{
                    fontSize: '0.8rem',
                    padding: '0.2rem 0.6rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: 4,
                    background: 'var(--bg-secondary, #eef1f5)',
                    cursor: creating ? 'wait' : 'pointer',
                  }}
                >
                  {creating ? t('workspace.creating') : t('workspace.create')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {showMembers && active && (
        <MembersPanel
          workspaceId={active.id}
          workspaceName={active.name}
          viewerRole={active.role}
          currentUserId={currentUserId}
          onClose={() => setShowMembers(false)}
          onOwnerTransferred={onMembershipChanged}
        />
      )}
    </div>
  );
}
