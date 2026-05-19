import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { EventType } from '@rp/shared';
import { broadcaster, type BroadcastEnvelope } from './broadcaster';

export interface EmitArgs {
  workspaceId: string;
  projectId?: string | null;
  userId: string | null;
  type: EventType;
  payload: unknown;
}

export async function emitEvent(prisma: PrismaClient, args: EmitArgs): Promise<void> {
  try {
    const id = randomUUID();
    const row = await prisma.event.create({
      data: {
        id,
        workspaceId: args.workspaceId,
        projectId: args.projectId ?? null,
        userId: args.userId ?? null,
        type: args.type,
        payload: JSON.stringify(args.payload ?? {}),
      },
    });
    // After the audit row is persisted, push a small envelope to all current
    // WS subscribers for this workspace. Fire-and-forget: broadcast failures
    // must never bubble up and break the mutation request.
    try {
      const envelope: BroadcastEnvelope = {
        v: 1,
        kind: 'event',
        workspaceId: args.workspaceId,
        projectId: args.projectId ?? null,
        eventType: args.type,
        eventId: row.id,
        at: row.createdAt.toISOString(),
      };
      broadcaster.broadcast(args.workspaceId, envelope);
    } catch (broadcastErr) {
      // eslint-disable-next-line no-console
      console.error('[events] broadcast failed', broadcastErr);
    }
  } catch (err) {
    // Best-effort: log and swallow. Audit-log failure must not break the request.
    // eslint-disable-next-line no-console
    console.error('[events] emitEvent failed', err);
  }
}

/**
 * Compute the set of changed fields between two row objects. Returns a map of
 * fieldName -> { from, to } for every field whose value differs. Dates are
 * compared via their ISO string.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: readonly (keyof T)[]
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of fields) {
    const a = before[key];
    const b = after[key];
    const av = a instanceof Date ? a.toISOString() : a;
    const bv = b instanceof Date ? b.toISOString() : b;
    if (av !== bv) {
      changes[key as string] = { from: av ?? null, to: bv ?? null };
    }
  }
  return changes;
}
