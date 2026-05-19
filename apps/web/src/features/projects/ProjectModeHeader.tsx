import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Project, ProjectMode } from '@rp/shared';
import { getProjectTypeMeta } from './projectTypes';
import { formatRelative } from '../../utils/time';

interface ProjectModeHeaderProps {
  project: Project;
  mode: ProjectMode;
  modeSwitching: boolean;
  canWriteActiveWorkspace: boolean;
  taskCount: number;
  onModeChange: (next: ProjectMode) => void;
  onBack: () => void;
  onDelete: () => void;
}

/**
 * Project topbar — adopts the redesign's `rd-topbar` shape:
 * back arrow → type chip → project name → "last touched" meta →
 * Progress/Deadline mode toggle → delete (when permitted).
 */
export function ProjectModeHeader({
  project,
  mode,
  modeSwitching,
  canWriteActiveWorkspace,
  taskCount,
  onModeChange,
  onBack,
  onDelete,
}: ProjectModeHeaderProps) {
  const { t } = useTranslation();
  const typeMeta = getProjectTypeMeta(project.type);

  const handleDeleteClick = () => {
    const msg =
      taskCount > 0
        ? t('project.confirmDeleteWithTasks', {
            name: project.name,
            count: taskCount,
          })
        : t('project.confirmDelete', { name: project.name });
    if (window.confirm(msg)) {
      onDelete();
    }
  };

  const lastTouched = formatRelative(project.updatedAt);
  const lastTouchedText = (t as (k: string, v?: Record<string, unknown>) => string)(
    lastTouched.key,
    lastTouched.values
  );

  return (
    <div className="rd-topbar">
      <button
        type="button"
        className="rd-icon-btn"
        onClick={onBack}
        aria-label={t('nav.projects')}
        title={t('nav.projects')}
      >
        ←
      </button>
      <span
        className="rd-type-chip"
        data-type={project.type}
        title={t(typeMeta.labelKey)}
      >
        {t(typeMeta.labelKey)}
      </span>
      <h1>{project.name}</h1>
      <span className="rd-meta">· {lastTouchedText}</span>
      <span className="rd-spacer" />
      <div
        role="group"
        aria-label={t('project.mode.label')}
        className="rd-mode-toggle"
      >
        <button
          type="button"
          className={`rd-seg ${mode === 'progress' ? 'on' : ''}`}
          onClick={() => onModeChange('progress')}
          disabled={modeSwitching || !canWriteActiveWorkspace}
          title={
            !canWriteActiveWorkspace
              ? t('projectMode.readOnly')
              : t('project.mode.progressHint')
          }
        >
          {t('project.mode.progress')}
        </button>
        <button
          type="button"
          className={`rd-seg ${mode === 'deadline' ? 'on' : ''}`}
          onClick={() => onModeChange('deadline')}
          disabled={modeSwitching || !canWriteActiveWorkspace}
          title={
            !canWriteActiveWorkspace
              ? t('projectMode.readOnly')
              : t('project.mode.deadlineHint')
          }
        >
          {t('project.mode.deadline')}
        </button>
      </div>
      {canWriteActiveWorkspace && (
        <button
          type="button"
          onClick={handleDeleteClick}
          title={t('project.deleteProject')}
          aria-label={t('project.deleteProject')}
          className="rd-icon-btn"
        >
          ×
        </button>
      )}
    </div>
  );
}
