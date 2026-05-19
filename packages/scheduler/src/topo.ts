import type { Dependency, ID, Task } from '../../shared/src/types';

export class CycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CycleError';
  }
}

export interface Graph {
  // adjacency list: from -> [to]
  adj: Map<ID, ID[]>;
  indeg: Map<ID, number>;
}

export function buildGraph(tasks: Task[], deps: Dependency[]): Graph {
  const adj = new Map<ID, ID[]>();
  const indeg = new Map<ID, number>();
  for (const t of tasks) {
    adj.set(t.id, []);
    indeg.set(t.id, 0);
  }
  for (const d of deps) {
    // Edge direction is predecessor -> successor regardless of dep type.
    const list = adj.get(d.fromTaskId);
    if (list) list.push(d.toTaskId);
    indeg.set(d.toTaskId, (indeg.get(d.toTaskId) || 0) + 1);
  }
  return { adj, indeg };
}

export function topoSort(tasks: Task[], deps: Dependency[]): ID[] {
  const { adj, indeg } = buildGraph(tasks, deps);
  const q: ID[] = [];
  for (const [id, deg] of indeg) if (deg === 0) q.push(id);
  const order: ID[] = [];
  let i = 0;
  while (i < q.length) {
    const u = q[i++];
    order.push(u);
    const nexts = adj.get(u) || [];
    for (const v of nexts) {
      const d = (indeg.get(v) || 0) - 1;
      indeg.set(v, d);
      if (d === 0) q.push(v);
    }
  }
  if (order.length !== tasks.length) {
    throw new CycleError('Dependency graph contains a cycle.');
  }
  return order;
}
