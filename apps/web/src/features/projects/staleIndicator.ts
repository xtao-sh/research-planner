// Computes a coarse "freshness" level for a project based on its last
// activity timestamp. Used by the project gallery to give a quick visual
// signal of which projects are dormant.

export type StaleLevel = 'fresh' | 'warm' | 'stale' | 'dormant';

export function getStaleLevel(lastActivityIso: string): {
  level: StaleLevel;
  days: number;
} {
  const days = Math.floor(
    (Date.now() - new Date(lastActivityIso).getTime()) / 86400000
  );
  if (days <= 1) return { level: 'fresh', days };
  if (days <= 7) return { level: 'warm', days };
  if (days <= 14) return { level: 'stale', days };
  return { level: 'dormant', days };
}
