// Scenario API helpers — wraps the existing project-scenario REST endpoints.
//
// The server already implements POST/GET on /api/projects/:id/scenarios and
// DELETE on /api/scenarios/:id. These wrappers normalize the JSON return shape
// for callers and reuse the shared fetchJson/sendJson helpers (auth, base URL,
// error mapping).

import { fetchJson, sendJson } from './client';
import type { Scenario } from '@rp/shared';
import type { DurationMode } from '@rp/scheduler';

export function getProjectScenarios(projectId: string): Promise<Scenario[]> {
  return fetchJson<Scenario[]>(`/api/projects/${projectId}/scenarios`);
}

export async function createScenario(
  projectId: string,
  body: { name: string; durationMode: DurationMode }
): Promise<Scenario> {
  const res = await sendJson(`/api/projects/${projectId}/scenarios`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function deleteScenario(scenarioId: string): Promise<void> {
  await sendJson(`/api/scenarios/${scenarioId}`, { method: 'DELETE' });
}
