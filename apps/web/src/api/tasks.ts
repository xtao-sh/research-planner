// Task-specific API helpers. Most task mutations go through inline `sendJson`
// calls in feature pages; this file is for cross-cutting helpers used in
// multiple surfaces (e.g. the Top of Mind pin button).
import type { Task } from '@rp/shared';
import { sendJson } from './client';

export async function setTaskFocus(taskId: string, focused: boolean): Promise<Task> {
  const res = await sendJson(`/api/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ focused }),
  });
  return (await res.json()) as Task;
}

/**
 * Reorder all tasks in a project. Server resets `priority = index + 1` for
 * each id in the array. Tasks not in the array keep their existing priority.
 */
export async function reorderTasks(projectId: string, taskIds: string[]): Promise<void> {
  await sendJson(`/api/projects/${projectId}/tasks/reorder`, {
    method: 'POST',
    body: JSON.stringify({ taskIds }),
  });
}

/**
 * Set the parent of a task (or null to make it top-level). Server validates
 * the parent chain (no self-cycle, depth ≤ MAX_PARENT_DEPTH, same project)
 * and returns 400 with a structured reason on rejection.
 */
export async function setTaskParent(
  taskId: string,
  parentTaskId: string | null
): Promise<Task> {
  const res = await sendJson(`/api/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ parentTaskId }),
  });
  return (await res.json()) as Task;
}
