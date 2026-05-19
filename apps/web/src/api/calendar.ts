// Calendar/Holiday API client: thin wrappers over the /api/workspaces calendar
// endpoints. See apps/server for validation rules and event semantics.

import type { WorkingCalendar, Holiday } from '@rp/shared';
import { fetchJson, sendJson } from './client';

export async function getCalendar(workspaceId: string): Promise<WorkingCalendar> {
  return fetchJson<WorkingCalendar>(`/api/workspaces/${workspaceId}/calendar`);
}

export async function updateCalendar(
  workspaceId: string,
  weeklyHours: string
): Promise<WorkingCalendar> {
  const res = await sendJson(`/api/workspaces/${workspaceId}/calendar`, {
    method: 'PUT',
    body: JSON.stringify({ weeklyHours }),
  });
  return (await res.json()) as WorkingCalendar;
}

export async function addHoliday(
  workspaceId: string,
  date: string,
  name: string
): Promise<Holiday> {
  const res = await sendJson(`/api/workspaces/${workspaceId}/holidays`, {
    method: 'POST',
    body: JSON.stringify({ date, name }),
  });
  return (await res.json()) as Holiday;
}

export async function deleteHoliday(holidayId: string): Promise<void> {
  await sendJson(`/api/holidays/${holidayId}`, { method: 'DELETE' });
}
