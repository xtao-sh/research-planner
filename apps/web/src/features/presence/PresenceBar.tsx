import { useTranslation } from 'react-i18next';
import type { PresenceMember, Project } from '@rp/shared';

interface PresenceBarProps {
  members: PresenceMember[];
  currentUserId: string | null;
  projects: Project[];
  onSelectProject?: (projectId: string) => void;
}

const MAX_VISIBLE = 5;

// Palette of saturated-but-readable colors for avatar backgrounds. Picking by
// userId hash gives each user a stable color across sessions.
const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function colorFor(userId: string): string {
  return AVATAR_COLORS[hashStr(userId) % AVATAR_COLORS.length];
}

function initialFor(m: PresenceMember): string {
  const src = (m.name && m.name.trim()) || m.email || '?';
  return src.charAt(0).toUpperCase();
}

function labelFor(m: PresenceMember): string {
  return (m.name && m.name.trim()) || m.email || '(anonymous)';
}

export function PresenceBar({
  members,
  currentUserId,
  projects,
  onSelectProject,
}: PresenceBarProps) {
  const { t } = useTranslation();

  // Hide yourself — you don't need to see your own presence chip.
  const others = members.filter((m) => m.userId !== currentUserId);
  if (others.length === 0) return null;

  const visible = others.slice(0, MAX_VISIBLE);
  const overflow = others.length - visible.length;

  const projectNameById = (pid: string | null): string | null => {
    if (!pid) return null;
    const p = projects.find((x) => x.id === pid);
    return p ? p.name : null;
  };

  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      aria-label="presence"
    >
      {visible.map((m, idx) => {
        const pname = projectNameById(m.projectId);
        const where = pname
          ? t('presence.viewing', { project: pname })
          : t('presence.onWorkspace');
        const tooltip = `${labelFor(m)} · ${where}`;
        const clickable = !!m.projectId && !!projectNameById(m.projectId) && !!onSelectProject;
        return (
          <button
            type="button"
            key={`${m.userId}-${idx}`}
            title={tooltip}
            aria-label={tooltip}
            disabled={!clickable}
            onClick={() => {
              if (clickable && m.projectId && onSelectProject) onSelectProject(m.projectId);
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: colorFor(m.userId),
              color: 'white',
              border: '2px solid white',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              marginLeft: idx === 0 ? 0 : -6,
              cursor: clickable ? 'pointer' : 'default',
              padding: 0,
            }}
          >
            {initialFor(m)}
          </button>
        );
      })}
      {overflow > 0 && (
        <span
          title={t('presence.more', { n: overflow })}
          style={{
            marginLeft: 2,
            padding: '2px 8px',
            borderRadius: 12,
            background: '#e5e7eb',
            color: '#374151',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

export default PresenceBar;
