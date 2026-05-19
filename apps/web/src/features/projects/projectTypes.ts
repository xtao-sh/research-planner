import type { ProjectType } from '@rp/shared';

export type ProjectTypeLabelKey =
  | 'project.type.research'
  | 'project.type.daily'
  | 'project.type.admin'
  | 'project.type.personal'
  | 'project.type.other';

export interface ProjectTypeMeta {
  type: ProjectType;
  color: string;     // hex
  icon: string;      // emoji
  labelKey: ProjectTypeLabelKey;
}

export const PROJECT_TYPES: ProjectTypeMeta[] = [
  { type: 'research', color: '#7c3aed', icon: '🔬', labelKey: 'project.type.research' },
  { type: 'daily',    color: '#10b981', icon: '☀️', labelKey: 'project.type.daily' },
  { type: 'admin',    color: '#f59e0b', icon: '📋', labelKey: 'project.type.admin' },
  { type: 'personal', color: '#3b82f6', icon: '🌱', labelKey: 'project.type.personal' },
  { type: 'other',    color: '#6b7280', icon: '📂', labelKey: 'project.type.other' },
];

export function getProjectTypeMeta(type: ProjectType | string | undefined): ProjectTypeMeta {
  return PROJECT_TYPES.find((t) => t.type === type) ?? PROJECT_TYPES[PROJECT_TYPES.length - 1];
}
