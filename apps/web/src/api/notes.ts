// Notes API client (Phase C). Notes are workspace-scoped quick captures
// that may or may not be filed to a project. Inbox = workspace notes
// where projectId is null and createdById === current user.

import type { Note, Task } from '@rp/shared';
import { fetchJson, sendJson } from './client';

export interface CreateNotePayload {
  workspaceId: string;
  projectId?: string | null;
  taskId?: string | null;
  body: string;
  tags?: string[];
}

export async function createNote(payload: CreateNotePayload): Promise<Note> {
  const res = await sendJson('/api/notes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return (await res.json()) as Note;
}

export async function getProjectNotes(projectId: string): Promise<Note[]> {
  return fetchJson<Note[]>(`/api/projects/${projectId}/notes`);
}

export async function getInbox(workspaceId: string): Promise<Note[]> {
  return fetchJson<Note[]>(`/api/workspaces/${workspaceId}/inbox`);
}

export interface UpdateNotePayload {
  body?: string;
  tags?: string[];
  projectId?: string | null;
  taskId?: string | null;
}

export async function updateNote(
  noteId: string,
  payload: UpdateNotePayload
): Promise<Note> {
  const res = await sendJson(`/api/notes/${noteId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return (await res.json()) as Note;
}

export async function deleteNote(noteId: string): Promise<void> {
  await sendJson(`/api/notes/${noteId}`, { method: 'DELETE' });
}

export async function promoteNoteToTask(
  noteId: string,
  projectId: string
): Promise<Task> {
  const res = await sendJson(`/api/notes/${noteId}/promote-to-task`, {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  });
  return (await res.json()) as Task;
}
