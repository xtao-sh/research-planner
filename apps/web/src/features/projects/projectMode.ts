import type { ProjectMode } from '@rp/shared';

export const PROJECT_MODES: { mode: ProjectMode; icon: string; labelKey: string; hintKey: string }[] = [
  { mode: 'progress', icon: '🌱', labelKey: 'project.mode.progress', hintKey: 'project.mode.progressHint' },
  { mode: 'deadline', icon: '⏰', labelKey: 'project.mode.deadline', hintKey: 'project.mode.deadlineHint' },
];

export function getModeMeta(mode: ProjectMode | undefined) {
  return PROJECT_MODES.find((m) => m.mode === mode) ?? PROJECT_MODES[0];
}
