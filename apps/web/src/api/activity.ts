// Activity feed API client.

import type { EventRecord } from '@rp/shared';
import { fetchJson } from './client';

interface ActivityOptions {
  limit?: number;
  before?: string;
}

function buildQuery(opts?: ActivityOptions): string {
  if (!opts) return '';
  const parts: string[] = [];
  if (typeof opts.limit === 'number') {
    parts.push(`limit=${encodeURIComponent(String(opts.limit))}`);
  }
  if (opts.before) {
    parts.push(`before=${encodeURIComponent(opts.before)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export async function getWorkspaceActivity(
  workspaceId: string,
  opts?: ActivityOptions
): Promise<EventRecord[]> {
  return fetchJson<EventRecord[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/activity${buildQuery(opts)}`
  );
}

export async function getProjectActivity(
  projectId: string,
  opts?: ActivityOptions
): Promise<EventRecord[]> {
  return fetchJson<EventRecord[]>(
    `/api/projects/${encodeURIComponent(projectId)}/activity${buildQuery(opts)}`
  );
}
