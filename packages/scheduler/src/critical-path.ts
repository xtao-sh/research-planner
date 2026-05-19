import type { Dependency, ID, Task } from '../../shared/src/types';
import { computeSchedule, criticalPathFromComputation } from './schedule';

export { criticalPathFromComputation };

export function criticalPath(tasks: Task[], deps: Dependency[]): ID[] {
  if (tasks.length === 0) return [];
  const comp = computeSchedule(tasks, deps, {
    projectId: tasks[0].projectId,
    projectStart: new Date(0),
  });
  return criticalPathFromComputation(comp);
}
