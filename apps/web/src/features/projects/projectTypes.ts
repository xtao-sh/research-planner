import type { ProjectType } from '@rp/shared';

export type ProjectTypeLabelKey =
  | 'project.type.research'
  | 'project.type.daily'
  | 'project.type.admin'
  | 'project.type.personal'
  | 'project.type.other';

export interface ProjectTypeMeta {
  type: ProjectType;
  /** CSS color value — references the --type-* custom property so the dot,
   *  swatch, and card stripe share one source and switch in dark mode. */
  color: string;
  icon: string;      // emoji
  labelKey: ProjectTypeLabelKey;
}

export const PROJECT_TYPES: ProjectTypeMeta[] = [
  { type: 'research', color: 'var(--type-research)', icon: '🔬', labelKey: 'project.type.research' },
  { type: 'daily',    color: 'var(--type-daily)',    icon: '☀️', labelKey: 'project.type.daily' },
  { type: 'admin',    color: 'var(--type-admin)',    icon: '📋', labelKey: 'project.type.admin' },
  { type: 'personal', color: 'var(--type-personal)', icon: '🌱', labelKey: 'project.type.personal' },
  { type: 'other',    color: 'var(--type-other)',    icon: '📂', labelKey: 'project.type.other' },
];

export function getProjectTypeMeta(type: ProjectType | string | undefined): ProjectTypeMeta {
  return PROJECT_TYPES.find((t) => t.type === type) ?? PROJECT_TYPES[PROJECT_TYPES.length - 1];
}
