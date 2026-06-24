// Artifacts API client. Artifacts are project-scoped attachments
// (link / file / code / data) shown on the project's Artifacts tab.
// Free-text prose lives in project Notes, not as an artifact kind.

import type { Artifact, ArtifactKind } from '@rp/shared';
import { fetchJson, sendJson } from './client';

export async function getProjectArtifacts(projectId: string): Promise<Artifact[]> {
  return fetchJson<Artifact[]>(`/api/projects/${projectId}/artifacts`);
}

export interface CreateArtifactPayload {
  kind: ArtifactKind;
  title: string;
  url?: string;
  notes?: string;
}

export async function createArtifact(
  projectId: string,
  payload: CreateArtifactPayload,
): Promise<Artifact> {
  const res = await sendJson(`/api/projects/${projectId}/artifacts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return (await res.json()) as Artifact;
}

export interface UpdateArtifactPayload {
  kind?: ArtifactKind;
  title?: string;
  url?: string | null;
  notes?: string | null;
}

export async function updateArtifact(
  artifactId: string,
  payload: UpdateArtifactPayload,
): Promise<Artifact> {
  const res = await sendJson(`/api/artifacts/${artifactId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return (await res.json()) as Artifact;
}

export async function deleteArtifact(artifactId: string): Promise<void> {
  await sendJson(`/api/artifacts/${artifactId}`, { method: 'DELETE' });
}
