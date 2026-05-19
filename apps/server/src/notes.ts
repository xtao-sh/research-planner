/**
 * Note helpers (Phase C).
 *
 * Notes are workspace-scoped, optionally project-scoped quick captures. Tags
 * are stored as JSON-encoded string arrays in the DB. We auto-extract any
 * `#hashtag` tokens from the body and merge them into the tag set on
 * create/update so the user can tag inline without leaving the textarea.
 */
import type { Prisma } from '@prisma/client';
import type { Note } from '@rp/shared';

// Unicode-aware hashtag pattern. Letters/digits/underscore/dash, 1-50 chars,
// and we keep it lowercased + deduped on the way out.
const HASHTAG_RE = /#([\p{L}\p{N}_-]{1,50})/gu;

export function extractHashtags(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(HASHTAG_RE)) {
    out.add(m[1].toLowerCase());
  }
  return Array.from(out);
}

export function mergeTags(explicit: string[] | undefined, body: string): string[] {
  const set = new Set<string>();
  for (const t of explicit ?? []) {
    const trimmed = t.trim();
    if (trimmed) set.add(trimmed.toLowerCase());
  }
  for (const t of extractHashtags(body)) set.add(t);
  return Array.from(set);
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

type NoteRow = Prisma.NoteGetPayload<{
  include: { createdBy: { select: { email: true } } };
}>;

export function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    createdById: row.createdById,
    createdByEmail: row.createdBy?.email ?? null,
    body: row.body,
    tags: parseTags(row.tags),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
