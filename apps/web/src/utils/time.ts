// Small relative-time formatter for activity feed rows. Intentionally coarse.
// Returns an i18n key + interpolation values rather than a finished string so
// the caller can translate it in the active language.

export interface RelativeTimeParts {
  key: 'event.justNow' | 'event.minutesAgo' | 'event.hoursAgo' | 'event.daysAgo';
  values?: { n: number };
}

export function formatRelative(iso: string, now: Date = new Date()): RelativeTimeParts {
  const then = new Date(iso).getTime();
  const diffMs = Math.max(0, now.getTime() - then);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return { key: 'event.justNow' };
  if (mins < 60) return { key: 'event.minutesAgo', values: { n: mins } };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { key: 'event.hoursAgo', values: { n: hrs } };
  const days = Math.floor(hrs / 24);
  return { key: 'event.daysAgo', values: { n: days } };
}
