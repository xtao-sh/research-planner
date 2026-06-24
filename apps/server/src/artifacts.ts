/**
 * Artifact helpers (Artifacts tab).
 *
 * Artifacts are project-scoped attachments: a typed link / file / code /
 * data reference produced or referenced by a project. Free-text prose belongs
 * in project Notes, not here. Mirrors the Note mapper
 * shape (createdBy email join) so the UI can attribute who added each one.
 */
import type { Prisma } from '@prisma/client';
import type { Artifact, ArtifactKind } from '@rp/shared';

type ArtifactRow = Prisma.ArtifactGetPayload<{
  include: { createdBy: { select: { email: true } } };
}>;

export function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as ArtifactKind,
    title: row.title,
    url: row.url,
    notes: row.notes,
    createdById: row.createdById,
    createdByEmail: row.createdBy?.email ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
