import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { InviteRecord } from '@rp/shared';
import { ApiError } from '../../api/client';
import {
  INVITABLE_ROLES,
  changeMemberRole,
  getWorkspaceInvites,
  inviteMember,
  listMembers,
  removeMember,
  revokeInvite,
  transferOwnership,
  WorkspaceMember,
  WorkspaceRole,
} from '../../api/workspaces';
import { canManageMembers, isOwner } from './permissions';
import { useToast } from '../../components/Toast';

interface MembersPanelProps {
  workspaceId: string;
  workspaceName: string;
  viewerRole: WorkspaceRole | null;
  currentUserId: string | null;
  onClose: () => void;
  onOwnerTransferred?: () => void;
}

export function MembersPanel({
  workspaceId,
  workspaceName,
  viewerRole,
  currentUserId,
  onClose,
  onOwnerTransferred,
}: MembersPanelProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('editor');
  const [inviting, setInviting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [changingUserId, setChangingUserId] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTarget, setTransferTarget] = useState<string>('');
  const [transferring, setTransferring] = useState(false);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  const canManage = canManageMembers(viewerRole);
  const viewerIsOwner = isOwner(viewerRole);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listMembers(workspaceId);
      setMembers(list);
      if (canManage) {
        try {
          const pending = await getWorkspaceInvites(workspaceId);
          setInvites(pending);
        } catch {
          // Non-fatal — member list already displayed.
          setInvites([]);
        }
      } else {
        setInvites([]);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, canManage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleInvite = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const email = inviteEmail.trim();
      if (!email) return;
      setInviting(true);
      setActionError(null);
      setCreatedInviteUrl(null);
      setCopiedLink(false);
      try {
        const result = await inviteMember(workspaceId, email, inviteRole);
        setInviteEmail('');
        setInviteRole('editor');
        if (result.kind === 'invite') {
          const url = `${window.location.origin}/?invite=${encodeURIComponent(
            result.invite.token
          )}`;
          setCreatedInviteUrl(url);
        }
        await refresh();
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 404) setActionError(t('workspace.notFoundEmail'));
          else if (err.status === 409) setActionError(t('workspace.alreadyMember'));
          else setActionError(err.message || t('workspace.inviteFailed'));
        } else {
          setActionError(
            err instanceof Error ? err.message : t('workspace.inviteFailed')
          );
        }
      } finally {
        setInviting(false);
      }
    },
    [inviteEmail, inviteRole, workspaceId, refresh, t]
  );

  const handleRemove = useCallback(
    async (userId: string) => {
      if (!window.confirm(t('workspace.confirmRemove'))) return;
      setRemovingUserId(userId);
      setActionError(null);
      try {
        await removeMember(workspaceId, userId);
        await refresh();
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          const msg = err.message || t('workspace.cannotRemoveLastAdmin');
          setActionError(msg);
          toast.push(msg, { kind: 'error' });
        } else {
          const msg =
            err instanceof Error ? err.message : t('workspace.removeFailed');
          setActionError(msg);
        }
      } finally {
        setRemovingUserId(null);
      }
    },
    [workspaceId, refresh, t, toast]
  );

  const handleRoleChange = useCallback(
    async (userId: string, newRole: WorkspaceRole) => {
      setChangingUserId(userId);
      setActionError(null);
      try {
        await changeMemberRole(workspaceId, userId, newRole);
        await refresh();
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message || t('workspace.changeRoleFailed')
            : err instanceof Error
            ? err.message
            : t('workspace.changeRoleFailed');
        setActionError(msg);
      } finally {
        setChangingUserId(null);
      }
    },
    [workspaceId, refresh, t]
  );

  const handleTransfer = useCallback(async () => {
    if (!transferTarget) return;
    setTransferring(true);
    setActionError(null);
    try {
      await transferOwnership(workspaceId, transferTarget);
      setShowTransfer(false);
      setTransferTarget('');
      if (onOwnerTransferred) onOwnerTransferred();
      await refresh();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message || t('workspace.transferFailed')
          : err instanceof Error
          ? err.message
          : t('workspace.transferFailed');
      setActionError(msg);
    } finally {
      setTransferring(false);
    }
  }, [workspaceId, transferTarget, refresh, t, onOwnerTransferred]);

  const handleRevokeInvite = useCallback(
    async (invite: InviteRecord) => {
      if (!window.confirm(t('invite.confirmRevoke', { email: invite.email }))) return;
      setRevokingInviteId(invite.id);
      setActionError(null);
      try {
        await revokeInvite(invite.id);
        await refresh();
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : t('workspace.inviteFailed');
        setActionError(msg);
      } finally {
        setRevokingInviteId(null);
      }
    },
    [refresh, t]
  );

  const handleCopyLink = useCallback(async () => {
    if (!createdInviteUrl) return;
    try {
      await navigator.clipboard.writeText(createdInviteUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard API may be blocked; show the URL for manual copy.
      window.prompt(t('invite.copyLink'), createdInviteUrl);
    }
  }, [createdInviteUrl, t]);

  const transferCandidates = useMemo(
    () => members.filter((m) => m.userId !== currentUserId && m.role !== 'owner'),
    [members, currentUserId]
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 620 }}
      >
        <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
        <h3 style={{ marginTop: 0, marginBottom: '0.25rem' }}>
          {t('workspace.members')}
        </h3>
        <div
          style={{
            color: 'var(--muted-color, #666)',
            fontSize: '0.85rem',
            marginBottom: '1rem',
          }}
        >
          {workspaceName}
        </div>

        {loading && <p>{t('common.loading')}</p>}
        {loadError && (
          <p className="error-message" style={{ marginBottom: '0.5rem' }}>
            {loadError}
          </p>
        )}

        {!loading && !loadError && (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              border: '1px solid var(--border-color, #ddd)',
              borderRadius: 6,
            }}
          >
            {members.map((m, idx) => {
              const isSelf = m.userId === currentUserId;
              const rowIsOwner = m.role === 'owner';
              const canChangeThisRow = canManage && !isSelf && !rowIsOwner;
              return (
                <li
                  key={m.userId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0.75rem',
                    borderTop:
                      idx === 0 ? 'none' : '1px solid var(--border-color, #eee)',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {m.name || m.email}
                      {isSelf && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: '0.7rem',
                            color: 'var(--muted-color, #666)',
                          }}
                        >
                          ({t('workspace.current')})
                        </span>
                      )}
                    </div>
                    {m.name && (
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--muted-color, #666)',
                        }}
                      >
                        {m.email}
                      </div>
                    )}
                  </div>
                  {canChangeThisRow ? (
                    <select
                      value={m.role}
                      onChange={(e) =>
                        void handleRoleChange(
                          m.userId,
                          e.target.value as WorkspaceRole
                        )
                      }
                      disabled={changingUserId === m.userId}
                      aria-label={t('workspace.inviteRole')}
                      style={{
                        fontSize: '0.8rem',
                        padding: '2px 6px',
                        border: '1px solid var(--border-color, #ddd)',
                        borderRadius: 4,
                      }}
                    >
                      {INVITABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`role.${r}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: 'var(--bg-secondary, #eef1f5)',
                        border: '1px solid var(--border-color, #ddd)',
                      }}
                    >
                      {t(`role.${m.role}`)}
                    </span>
                  )}
                  {canManage && !rowIsOwner && !isSelf && (
                    <button
                      type="button"
                      onClick={() => void handleRemove(m.userId)}
                      disabled={removingUserId === m.userId}
                      style={{
                        padding: '2px 10px',
                        fontSize: '0.8rem',
                        border: '1px solid var(--border-color, #ddd)',
                        borderRadius: 4,
                        background: 'transparent',
                        cursor: removingUserId === m.userId ? 'wait' : 'pointer',
                      }}
                    >
                      {t('workspace.remove')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canManage && (
          <div style={{ marginTop: '0.75rem' }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: '0.85rem',
                marginBottom: 4,
              }}
            >
              {t('invite.pendingSection')}
            </div>
            {invites.length === 0 ? (
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--muted-color, #666)',
                }}
              >
                {t('invite.noPending')}
              </div>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: 6,
                }}
              >
                {invites.map((inv, idx) => (
                  <li
                    key={inv.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.4rem 0.75rem',
                      borderTop:
                        idx === 0 ? 'none' : '1px solid var(--border-color, #eee)',
                      gap: '0.5rem',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '0.85rem' }}>
                        {inv.email} · {t(`role.${inv.role}`)}
                      </div>
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--muted-color, #888)',
                        }}
                      >
                        {t('invite.expiresIn', {
                          time: new Date(inv.expiresAt).toLocaleDateString(i18n.language),
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRevokeInvite(inv)}
                      disabled={revokingInviteId === inv.id}
                      aria-label={t('invite.revoke')}
                      style={{
                        padding: '2px 8px',
                        fontSize: '0.8rem',
                        border: '1px solid var(--border-color, #ddd)',
                        borderRadius: 4,
                        background: 'transparent',
                        cursor:
                          revokingInviteId === inv.id ? 'wait' : 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {viewerIsOwner && !showTransfer && transferCandidates.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setShowTransfer(true)}
              style={{
                padding: '0.3rem 0.75rem',
                fontSize: '0.85rem',
                border: '1px solid var(--border-color, #ddd)',
                borderRadius: 4,
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              {t('workspace.transferOwnership')}
            </button>
          </div>
        )}

        {viewerIsOwner && showTransfer && (
          <div
            style={{
              marginTop: '0.75rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--border-color, #eee)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {t('workspace.transferOwnershipTitle', { name: workspaceName })}
            </div>
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--muted-color, #666)',
                marginBottom: 8,
              }}
            >
              {t('workspace.transferOwnershipHint')}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <select
                value={transferTarget}
                onChange={(e) => setTransferTarget(e.target.value)}
                aria-label={t('workspace.transferTarget')}
                style={{
                  flex: '1 1 auto',
                  padding: '0.35rem 0.5rem',
                  fontSize: '0.85rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: 4,
                }}
              >
                <option value="">— {t('workspace.transferTarget')} —</option>
                {transferCandidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.email} ({t(`role.${m.role}`)})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleTransfer()}
                disabled={transferring || !transferTarget}
                style={{
                  padding: '0.35rem 0.9rem',
                  fontSize: '0.85rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: 4,
                  background: 'var(--bg-secondary, #eef1f5)',
                  cursor: transferring ? 'wait' : 'pointer',
                }}
              >
                {transferring
                  ? t('workspace.transferring')
                  : t('workspace.transferConfirm')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTransfer(false);
                  setTransferTarget('');
                }}
                disabled={transferring}
                style={{
                  padding: '0.35rem 0.6rem',
                  fontSize: '0.85rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: 4,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {canManage && (
          <form
            onSubmit={handleInvite}
            style={{
              marginTop: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--border-color, #eee)',
            }}
          >
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t('workspace.inviteEmail')}
                required
                style={{
                  flex: '1 1 220px',
                  padding: '0.4rem 0.5rem',
                  fontSize: '0.9rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: 4,
                }}
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                aria-label={t('workspace.inviteRole')}
                style={{
                  padding: '0.4rem 0.5rem',
                  fontSize: '0.9rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: 4,
                }}
              >
                {INVITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}`)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
                style={{
                  padding: '0.4rem 1rem',
                  fontSize: '0.9rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: 4,
                  background: 'var(--bg-secondary, #eef1f5)',
                  cursor: inviting ? 'wait' : 'pointer',
                }}
              >
                {inviting ? t('workspace.inviting') : t('workspace.invite')}
              </button>
            </div>
          </form>
        )}
        {createdInviteUrl && (
          <div
            style={{
              marginTop: '0.6rem',
              padding: '0.5rem 0.75rem',
              background: 'var(--bg-secondary, #eef1f5)',
              border: '1px solid var(--border-color, #ddd)',
              borderRadius: 4,
              fontSize: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div>{t('invite.created')}</div>
            <div
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <code
                style={{
                  flex: '1 1 auto',
                  fontSize: '0.75rem',
                  padding: '2px 6px',
                  background: 'var(--rd-surface, #fff)',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: 3,
                  overflow: 'auto',
                  whiteSpace: 'nowrap',
                }}
              >
                {createdInviteUrl}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                style={{
                  padding: '2px 10px',
                  fontSize: '0.8rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: 4,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                {copiedLink ? t('invite.linkCopied') : t('invite.copyLink')}
              </button>
            </div>
          </div>
        )}
        {actionError && (
          <div
            className="error-message"
            style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}
          >
            {actionError}
          </div>
        )}
      </div>
    </div>
  );
}
