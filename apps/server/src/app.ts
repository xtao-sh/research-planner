import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { schedule, buildGraph, CycleError, DurationMode } from '@rp/scheduler';
import type { Dependency, Milestone, Project, Scenario, ScheduleResult, Task, TaskSize } from '@rp/shared';
import { seed } from './seed';
import {
  registerAuthPlugin,
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  sessionCookieName,
  buildSessionCookieOptions,
  buildClearCookieOptions,
  lookupSession,
} from './auth';
import { broadcaster, type SocketLike } from './broadcaster';
import { presence } from './presence';
import { clientFrameSchema } from './ws-schemas';
import type { PresenceFrame } from '@rp/shared';
import {
  ALL_ROLES,
  INVITABLE_ROLES,
  assertProjectAccess,
  assertWorkspaceAccess,
  assertWorkspaceManagerRole,
  canManageMembers as canManageMembersFn,
  canManageWorkspace,
  canWrite,
  isOwner,
} from './workspace';
import type { WorkspaceRole } from './workspace';
import { emitEvent, diffFields } from './events';
import { mergeTags, toNote, parseTags } from './notes';
import type { EventRecord, InviteRecord, InvitePreview } from '@rp/shared';
import {
  defaultWeeklyHoursJSON,
  ensureWorkspaceCalendar,
  loadCalendarDescriptorForWorkspace,
  parseWeeklyHoursString,
  toWorkingCalendarShape,
} from './calendar';

// ---------------- Row ↔ shared type helpers ----------------

type TaskRow = Prisma.TaskGetPayload<{}>;
type ProjectRow = Prisma.ProjectGetPayload<{}>;
type MilestoneRow = Prisma.MilestoneGetPayload<{}>;
type DependencyRow = Prisma.DependencyGetPayload<{}>;
type ScenarioRow = Prisma.ScenarioGetPayload<{}>;

function isoOrUndef(d: Date | null | undefined): string | undefined {
  return d ? d.toISOString() : undefined;
}

function parseLabels(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : undefined;
  } catch {
    return undefined;
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    type: (row.type ?? 'other') as Project['type'],
    mode: ((row as { mode?: string }).mode ?? 'progress') as Project['mode'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startDate: isoOrUndef(row.startDate),
  };
}

function toTask(row: TaskRow, hasChildren?: boolean): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    type: row.type as Task['type'],
    status: row.status as Task['status'],
    estimate: {
      o: row.estimateO,
      m: row.estimateM,
      p: row.estimateP,
      confidence: row.confidence ?? undefined,
    },
    priority: row.priority,
    size: row.size as TaskSize,
    intensity: (row as TaskRow & { intensity?: number | null }).intensity ?? undefined,
    labels: parseLabels(row.labels),
    assignee: row.assignee ?? undefined,
    startPlanned: isoOrUndef(row.startPlanned),
    endPlanned: isoOrUndef(row.endPlanned),
    startedAt: isoOrUndef(row.startedAt),
    finishedAt: isoOrUndef(row.finishedAt),
    focusedAt: isoOrUndef(row.focusedAt),
    blockedAt: isoOrUndef(row.blockedAt),
    dueSoft: isoOrUndef(row.dueSoft),
    dueHard: isoOrUndef(row.dueHard),
    timeframeBucket:
      ((row as TaskRow & { timeframeBucket?: string | null }).timeframeBucket as
        Task['timeframeBucket']
        | undefined) ?? undefined,
    timeframeAnchor: isoOrUndef(
      (row as TaskRow & { timeframeAnchor?: Date | null }).timeframeAnchor ?? null
    ),
    milestoneId: row.milestoneId ?? undefined,
    parentTaskId: (row as TaskRow & { parentTaskId?: string | null })
      .parentTaskId ?? undefined,
    hasChildren: hasChildren ?? undefined,
    notes: row.notes ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Maximum allowed parent depth (1=root has child, 2=root→child→grandchild,
 *  3=root→child→grandchild→great-grandchild). Anything beyond 3 levels gets
 *  rejected by the cycle-check in PUT /api/tasks/:id. CJK titles + indent
 *  rendering already break above this. */
const MAX_PARENT_DEPTH = 3;

/** Walk parents starting at `candidateParentId`. Reject if we ever land on
 *  `taskId` itself (cycle) or if depth exceeds MAX_PARENT_DEPTH. Returns
 *  `{ ok: true }` on success or `{ ok: false, reason }` describing why.
 *  Takes the Prisma client as a parameter so the helper can be defined at
 *  module scope (route handlers below pass `app.prisma`). */
async function checkParentChain(
  prismaClient: PrismaClient | Prisma.TransactionClient,
  taskId: string,
  candidateParentId: string | null,
  projectId: string
): Promise<{ ok: true } | { ok: false; reason: 'self' | 'cycle' | 'cross-project' | 'depth' | 'missing' }> {
  if (!candidateParentId) return { ok: true };
  if (candidateParentId === taskId) return { ok: false, reason: 'self' };
  let cur: string | null = candidateParentId;
  const seen = new Set<string>();
  let depth = 0;
  while (cur) {
    if (cur === taskId) return { ok: false, reason: 'cycle' };
    if (seen.has(cur)) return { ok: false, reason: 'cycle' };
    seen.add(cur);
    depth += 1;
    if (depth > MAX_PARENT_DEPTH) return { ok: false, reason: 'depth' };
    const p: { parentTaskId: string | null; projectId: string } | null =
      await prismaClient.task.findUnique({
        where: { id: cur },
        select: { parentTaskId: true, projectId: true },
      });
    if (!p) return { ok: false, reason: 'missing' };
    if (p.projectId !== projectId) return { ok: false, reason: 'cross-project' };
    cur = p.parentTaskId;
  }
  return { ok: true };
}

function toDependency(row: DependencyRow): Dependency {
  return {
    id: row.id,
    projectId: row.projectId,
    fromTaskId: row.fromTaskId,
    toTaskId: row.toTaskId,
    type: row.type as Dependency['type'],
    lag: row.lag,
  };
}

function toMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    criteria: row.criteria ?? undefined,
    startDate: isoOrUndef(row.startDate),
    dueSoft: isoOrUndef(row.dueSoft),
    dueHard: isoOrUndef(row.dueHard),
  };
}

function toScenario(row: ScenarioRow): Scenario {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    durationMode: row.durationMode as Scenario['durationMode'],
    createdAt: row.createdAt.toISOString(),
    snapshot: JSON.parse(row.snapshot) as ScheduleResult,
  };
}

// ---------------- Zod schemas ----------------

const isoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), 'invalid date');

const taskTypeSchema = z.enum([
  'thinking',
  'reading',
  'research',
  'experiment',
  'coding',
  'analysis',
  'writing',
  'communication',
  'admin',
]);

const taskStatusSchema = z.enum(['todo', 'doing', 'blocked', 'review', 'done']);

const taskSizeSchema = z.enum(['xs', 's', 'm', 'l', 'xl']);

const timeframeBucketSchema = z.enum(['week', 'month', 'quarter', 'year', 'someday']);

const estimateSchema = z.object({
  o: z.number().finite().min(0).optional(),
  m: z.number().finite().min(0).optional(),
  p: z.number().finite().min(0).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  type: z.enum(['research', 'daily', 'admin', 'personal', 'other']).optional().default('other'),
  mode: z.enum(['progress', 'deadline']).optional().default('progress'),
  startDate: isoDateTime.optional(),
});

const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  type: z.enum(['research', 'daily', 'admin', 'personal', 'other']).optional(),
  mode: z.enum(['progress', 'deadline']).optional(),
  startDate: isoDateTime.optional(),
});

const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  type: taskTypeSchema.optional(),
  status: taskStatusSchema.optional(),
  estimate: estimateSchema.optional(),
  size: taskSizeSchema.optional(),
  intensity: z.number().int().min(1).max(5).nullish(),
  priority: z.number().finite().optional(),
  labels: z.array(z.string().max(50)).max(50).optional(),
  assignee: z.string().max(100).optional(),
  dueSoft: isoDateTime.optional(),
  dueHard: isoDateTime.optional(),
  /** Fuzzy 'finish-in-about' bucket. Setting this without timeframeAnchor
   *  is fine — the server fills the anchor with `now()` on first set. Pass
   *  null to explicitly clear the bucket; the anchor is cleared alongside. */
  timeframeBucket: timeframeBucketSchema.nullable().optional(),
  timeframeAnchor: isoDateTime.nullable().optional(),
  milestoneId: z.string().optional(),
  /** Optional parent task — if present, this task becomes a subtask of it.
   *  Server validates: same project, no cycle, depth ≤ MAX_PARENT_DEPTH. */
  parentTaskId: z.string().nullable().optional(),
  notes: z.string().max(10000).optional(),
});

const taskUpdateSchema = taskCreateSchema.partial().extend({
  startPlanned: isoDateTime.optional(),
  endPlanned: isoDateTime.optional(),
  startedAt: isoDateTime.optional().nullable(),
  finishedAt: isoDateTime.optional().nullable(),
  focusedAt: isoDateTime.optional().nullable(),
  blockedAt: isoDateTime.optional().nullable(),
  focused: z.boolean().optional(),
});

const dependencyCreateSchema = z.object({
  fromTaskId: z.string().min(1),
  toTaskId: z.string().min(1),
  type: z.enum(['FS', 'SS', 'FF', 'SF']).optional().default('FS'),
  lag: z.number().int().optional().default(0),
});

const milestoneCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  criteria: z.string().max(2000).optional(),
  startDate: isoDateTime.optional(),
  dueSoft: isoDateTime.optional(),
  dueHard: isoDateTime.optional(),
});

const milestoneUpdateSchema = milestoneCreateSchema.partial();

const scheduleRequestSchema = z.object({
  durationMode: z.enum(['expected', 'optimistic', 'pessimistic']).optional(),
});

const scenarioCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  durationMode: z.enum(['expected', 'optimistic', 'pessimistic']),
});

// Email validator: permissive — accepts forms like "demo@local" (no TLD) so
// local/dev accounts work. Requires exactly one '@' with non-empty local and
// domain parts.
const emailField = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(/^[^@\s]+@[^@\s]+$/, 'Invalid email');

const registerSchema = z.object({
  email: emailField,
  password: z.string().min(8).max(200),
  name: z.string().trim().max(100).optional(),
});

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(200),
});

const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

const roleEnum = z.enum(ALL_ROLES);
const invitableRoleEnum = z.enum(INVITABLE_ROLES);

const workspaceMemberInviteSchema = z.object({
  email: emailField,
  role: invitableRoleEnum,
});

const memberRoleChangeSchema = z.object({
  role: roleEnum,
});

const ownershipTransferSchema = z.object({
  userId: z.string().min(1),
});

const inviteAcceptSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(1).max(200).optional(),
  name: z.string().trim().max(100).optional(),
});

// Working calendar schemas (Phase 3b).
//
// weeklyHours is stored as a JSON-encoded string; we validate the decoded
// shape here to give callers a 400 with a useful message rather than a 500.
const calendarPutSchema = z.object({
  weeklyHours: z
    .string()
    .refine((s) => {
      try {
        const parsed = JSON.parse(s);
        if (!Array.isArray(parsed) || parsed.length !== 7) return false;
        const re = /^\d\d:\d\d-\d\d:\d\d$/;
        for (const e of parsed) {
          if (e === null) continue;
          if (typeof e !== 'string' || !re.test(e)) return false;
          const m = re.exec(e)!;
          const [sh, sm, eh, em] = e.split(/[-:]/).map(Number);
          void m;
          if (
            !Number.isFinite(sh) ||
            !Number.isFinite(sm) ||
            !Number.isFinite(eh) ||
            !Number.isFinite(em)
          )
            return false;
          if (sh < 0 || sh > 23 || eh < 0 || eh > 24) return false;
          if (sm < 0 || sm > 59 || em < 0 || em > 59) return false;
          if (sh * 60 + sm >= eh * 60 + em) return false;
        }
        return true;
      } catch {
        return false;
      }
    }, 'weeklyHours must be a JSON array of 7 entries, each null or "HH:MM-HH:MM"'),
});

const holidayDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const holidayCreateSchema = z.object({
  date: z.string().regex(holidayDateRegex, 'date must be YYYY-MM-DD').refine((s) => {
    // Guard against impossible dates like 2026-02-31.
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, 'date must be a valid calendar date'),
  name: z.string().trim().min(1).max(200),
});

const projectCreateExtendedSchema = projectCreateSchema.extend({
  workspaceId: z.string().min(1).optional(),
});

const projectListQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
});

const noteCreateSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  body: z.string().min(1).max(50_000),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
});

const noteUpdateSchema = z.object({
  body: z.string().min(1).max(50_000).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  // null = move back to inbox; string = file to that project
  projectId: z.union([z.string().min(1), z.null()]).optional(),
});

const notePromoteSchema = z.object({
  projectId: z.string().min(1),
});

const noteListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z
    .string()
    .refine((s) => !Number.isNaN(new Date(s).getTime()), 'invalid date')
    .optional(),
});

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: isoDateTime.optional(),
});

type EventRowWithUser = Prisma.EventGetPayload<{
  include: { user: { select: { email: true } } };
}>;

function serializeEvent(row: EventRowWithUser): EventRecord {
  let payload: unknown;
  try {
    payload = row.payload ? JSON.parse(row.payload) : {};
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    userId: row.userId,
    userEmail: row.user?.email ?? null,
    type: row.type as EventRecord['type'],
    payload,
    createdAt: row.createdAt.toISOString(),
  };
}

function zodErrorPayload(err: z.ZodError) {
  return {
    message: 'Validation failed',
    issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
  };
}

// ---------------- Cycle detection ----------------

function wouldCreateCycle(
  tasks: Task[],
  existingDeps: Dependency[],
  fromTaskId: string,
  toTaskId: string
): boolean {
  const trialDeps: Dependency[] = [
    ...existingDeps,
    {
      id: '__trial__',
      projectId: tasks[0]?.projectId ?? '',
      fromTaskId,
      toTaskId,
      type: 'FS',
      lag: 0,
    },
  ];
  const { adj, indeg } = buildGraph(tasks, trialDeps);
  const q: string[] = [];
  for (const [id, d] of indeg) if (d === 0) q.push(id);
  let visited = 0;
  let i = 0;
  const indegCopy = new Map(indeg);
  while (i < q.length) {
    const u = q[i++];
    visited++;
    for (const v of adj.get(u) || []) {
      const d = (indegCopy.get(v) || 0) - 1;
      indegCopy.set(v, d);
      if (d === 0) q.push(v);
    }
  }
  return visited !== tasks.length;
}

// ---------------- Server ----------------

async function buildServer(prisma: PrismaClient): Promise<FastifyInstance> {
  const isProd = process.env.NODE_ENV === 'production';
  // Multi-user mode toggles auth/invite endpoints. Defaults to 0 (single-user
  // local mode) so /api/auth/register|login|logout and the entire invite flow
  // return 410 Gone. Flip MULTI_USER=1 to re-enable for a real deployment.
  const isMultiUser = process.env.MULTI_USER === '1';
  const app = Fastify({
    logger: true,
    bodyLimit: 1 * 1024 * 1024, // 1 MB
  });

  /**
   * Gate project-mutating endpoints. Returns the project+role on success;
   * otherwise replies with 404 (non-member / missing) or 403 (viewer/commenter)
   * and returns null so the caller can early-return.
   */
  async function requireProjectWrite(
    projectId: string,
    userId: string,
    rep: FastifyReply
  ): Promise<{ project: Prisma.ProjectGetPayload<{}>; role: WorkspaceRole } | null> {
    const access = await assertProjectAccess(prisma, projectId, userId);
    if (!access) {
      rep.code(404).send({ message: 'Not found' });
      return null;
    }
    if (!canWrite(access.role)) {
      rep.code(403).send({ message: 'Forbidden: write access required' });
      return null;
    }
    return access;
  }

  async function touchProject(projectId: string) {
    await prisma.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    }).catch(() => { /* ignore if project vanished */ });
  }

  // Rate limit: 200 req/min per IP globally, mitigates abusive clients without
  // affecting normal UI interaction. Can be tuned via RATE_LIMIT_MAX env var.
  app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX || 200),
    timeWindow: '1 minute',
    allowList: isProd ? undefined : ['127.0.0.1', '::1'], // exempt loopback in dev
  });

  const devOrigins = [
    'http://localhost:3060',
    'http://127.0.0.1:3060',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  const customOrigin = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowList = isProd ? customOrigin : [...devOrigins, ...customOrigin];

  app.register(cors, {
    origin: allowList,
    credentials: true,
  });

  // Register auth plugin: @fastify/cookie + preHandler that enforces session
  // auth on /api/* (with health/ready/register/login exempt).
  await registerAuthPlugin(app, prisma);

  // ---------------- WebSocket (real-time sync) ----------------
  // Server-push only: broadcasts small envelopes when any event is emitted in
  // a workspace. Auth happens on upgrade via the session cookie. Close code
  // 4401 (application-defined) signals "unauthorized" to the client.
  await app.register(websocket);

  // Parse the `rp_sid` cookie manually off the raw Cookie header. Fastify's
  // cookie plugin normally populates req.cookies during the preHandler chain,
  // but the WS upgrade path runs outside the usual lifecycle on some setups,
  // so this is the most reliable approach.
  function readSidFromHeader(header: string | undefined): string | null {
    if (!header) return null;
    for (const part of header.split(';')) {
      const [rawKey, ...rest] = part.split('=');
      const key = rawKey.trim();
      if (key === sessionCookieName) {
        return decodeURIComponent(rest.join('=').trim());
      }
    }
    return null;
  }

  app.get('/ws/workspace/:id', { websocket: true }, async (socket, req) => {
    const workspaceId = (req.params as { id: string }).id;
    let user: { id: string; email: string; name: string | null } | null = null;
    if (isMultiUser) {
      // Cookie/session-based auth on the WS upgrade.
      const sid = readSidFromHeader(req.headers.cookie);
      if (!sid) {
        try { socket.close(4401, 'no session'); } catch { /* ignore */ }
        return;
      }
      const sess = await lookupSession(prisma, sid);
      if (!sess) {
        try { socket.close(4401, 'session not found'); } catch { /* ignore */ }
        return;
      }
      user = await prisma.user.findUnique({
        where: { id: sess.userId },
        select: { id: true, email: true, name: true },
      });
      if (!user) {
        try { socket.close(4401, 'user not found'); } catch { /* ignore */ }
        return;
      }
    } else {
      // Single-user mode: only loopback connections may attach.
      const ip = req.ip;
      const isLoopback =
        ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
      if (!isLoopback) {
        try { socket.close(4403, 'forbidden'); } catch { /* ignore */ }
        return;
      }
      user = await prisma.user.findUnique({
        where: { email: 'demo@local' },
        select: { id: true, email: true, name: true },
      });
      if (!user) {
        try { socket.close(4500, 'no local user'); } catch { /* ignore */ }
        return;
      }
    }
    const access = await assertWorkspaceAccess(prisma, workspaceId, user.id);
    if (!access) {
      try { socket.close(4404, 'workspace not found'); } catch { /* ignore */ }
      return;
    }

    // Cast narrowly: the @fastify/websocket socket has the same runtime shape
    // as our SocketLike contract (send/readyState/on('close')), but its type
    // carries extra methods we don't need.
    const s = socket as unknown as SocketLike;
    const socketId = randomUUID();
    const sinceIso = new Date().toISOString();

    broadcaster.addClient(workspaceId, s);
    presence.addSocket(workspaceId, socketId, {
      socket: s,
      userId: user.id,
      email: user.email,
      name: user.name,
      projectId: null,
      sinceIso,
    });
    emitPresence(workspaceId);

    // Inbound frames: hello / project / ping. Unknown/malformed frames are
    // logged and dropped (never disconnect for bad input).
    socket.on('message', (raw: Buffer | string) => {
      let parsed: unknown;
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        parsed = JSON.parse(text);
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[ws] dropped non-JSON frame');
        return;
      }
      const result = clientFrameSchema.safeParse(parsed);
      if (!result.success) {
        // eslint-disable-next-line no-console
        console.warn('[ws] dropped invalid frame');
        return;
      }
      const frame = result.data;
      if (frame.type === 'hello' || frame.type === 'project') {
        presence.updateProject(workspaceId, socketId, frame.projectId);
        emitPresence(workspaceId);
      }
      // 'ping': keepalive only; no state change needed for MVP.
    });

    socket.on('close', () => {
      broadcaster.removeClient(workspaceId, s);
      presence.removeSocket(workspaceId, socketId);
      emitPresence(workspaceId);
    });
  });

  /**
   * Push the current presence member list to every socket in the workspace.
   * Fire-and-forget: a failed send drops that client from the broadcaster,
   * mirroring how regular event broadcasts behave.
   */
  function emitPresence(workspaceId: string): void {
    const frame: PresenceFrame = {
      v: 1,
      kind: 'presence',
      members: presence.listMembers(workspaceId),
    };
    const data = JSON.stringify(frame);
    const sockets = Array.from(broadcaster.getClients(workspaceId));
    for (const ws of sockets) {
      if (ws.readyState !== 1) {
        broadcaster.removeClient(workspaceId, ws);
        continue;
      }
      try {
        ws.send(data);
      } catch {
        broadcaster.removeClient(workspaceId, ws);
      }
    }
  }

  // ---------------- Auth endpoints ----------------

  app.post('/api/auth/register', async (req, rep) => {
    if (!isMultiUser) return rep.code(410).send({ message: 'Auth disabled in single-user mode' });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const { email, password, name } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return rep.code(409).send({ message: 'Email already registered' });

    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: userId,
            email: normalizedEmail,
            passwordHash,
            name: name ?? null,
          },
        });
        await tx.workspace.create({
          data: {
            id: workspaceId,
            name: `${normalizedEmail}'s workspace`,
          },
        });
        await tx.workspaceMember.create({
          data: {
            id: randomUUID(),
            workspaceId,
            userId,
            role: 'owner',
          },
        });
        await tx.workingCalendar.create({
          data: {
            id: randomUUID(),
            workspaceId,
            weeklyHours: defaultWeeklyHoursJSON,
          },
        });
        return tx.user.update({
          where: { id: userId },
          data: { defaultWorkspaceId: workspaceId },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return rep.code(409).send({ error: 'emailTaken' });
      }
      throw err;
    }
    const session = await createSession(prisma, user.id);
    rep.setCookie(sessionCookieName, session.id, buildSessionCookieOptions(isProd));
    return rep.code(201).send({ id: user.id, email: user.email, name: user.name });
  });

  app.post('/api/auth/login', async (req, rep) => {
    if (!isMultiUser) return rep.code(410).send({ message: 'Auth disabled in single-user mode' });
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) return rep.code(401).send({ message: 'Invalid credentials' });
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return rep.code(401).send({ message: 'Invalid credentials' });

    const session = await createSession(prisma, user.id);
    rep.setCookie(sessionCookieName, session.id, buildSessionCookieOptions(isProd));
    return rep.code(200).send({ id: user.id, email: user.email, name: user.name });
  });

  app.post('/api/auth/logout', async (req, rep) => {
    if (!isMultiUser) return rep.code(410).send({ message: 'Auth disabled in single-user mode' });
    const sid = req.cookies?.[sessionCookieName];
    if (sid) {
      await deleteSession(prisma, sid);
    }
    rep.clearCookie(sessionCookieName, buildClearCookieOptions(isProd));
    return rep.code(204).send();
  });

  app.get('/api/auth/me', async (req, rep) => {
    if (!req.user) return rep.code(401).send({ message: 'Unauthorized' });
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true },
    });
    if (!user) return rep.code(401).send({ message: 'Unauthorized' });
    // Expose deployment mode so the frontend can hide multi-user-only chrome
    // (workspace switcher, presence, WS connection dot, etc.) when running
    // in single-user local mode.
    return { ...user, multiUser: isMultiUser };
  });

  // Liveness: process is up
  app.get('/api/health', async () => ({ ok: true }));
  // Readiness: store is loaded and server can handle requests
  app.get('/api/ready', async () => {
    const count = await prisma.project.count();
    return { ok: true, projects: count };
  });

  // ---------------- Workspaces ----------------

  app.get('/api/workspaces', async (req) => {
    const userId = req.user!.id;
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    });
    // Gather member counts in a single grouped query.
    const wsIds = memberships.map((m) => m.workspaceId);
    const counts = wsIds.length
      ? await prisma.workspaceMember.groupBy({
          by: ['workspaceId'],
          where: { workspaceId: { in: wsIds } },
          _count: { _all: true },
        })
      : [];
    const countMap = new Map<string, number>();
    for (const c of counts) countMap.set(c.workspaceId, c._count._all);
    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role as WorkspaceRole,
      memberCount: countMap.get(m.workspaceId) ?? 0,
    }));
  });

  app.post('/api/workspaces', async (req, rep) => {
    const parsed = workspaceCreateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const userId = req.user!.id;
    const wsId = randomUUID();
    const ws = await prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: { id: wsId, name: parsed.data.name },
      });
      await tx.workspaceMember.create({
        data: {
          id: randomUUID(),
          workspaceId: wsId,
          userId,
          role: 'owner',
        },
      });
      // Default working calendar: Mon-Fri 09:00-18:00 UTC, no holidays.
      await tx.workingCalendar.create({
        data: {
          id: randomUUID(),
          workspaceId: wsId,
          weeklyHours: defaultWeeklyHoursJSON,
        },
      });
      return created;
    });
    await emitEvent(prisma, {
      workspaceId: ws.id,
      projectId: null,
      userId,
      type: 'workspace.created',
      payload: { id: ws.id, name: ws.name },
    });
    return rep.code(201).send({
      id: ws.id,
      name: ws.name,
      role: 'owner' as WorkspaceRole,
      memberCount: 1,
    });
  });

  app.get('/api/workspaces/:id/members', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const access = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    return members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name ?? undefined,
      role: m.role as WorkspaceRole,
    }));
  });

  app.post('/api/workspaces/:id/members', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const parsed = workspaceMemberInviteSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));

    // Caller must be able to manage members. Non-members get 404 to hide
    // existence, non-managers get 403.
    const access = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });
    const mgr = await assertWorkspaceManagerRole(prisma, id, req.user!.id);
    if (!mgr) {
      return rep.code(403).send({ message: 'Only admins can invite members' });
    }

    const targetEmail = parsed.data.email.toLowerCase();
    const target = await prisma.user.findUnique({ where: { email: targetEmail } });

    if (target) {
      // Existing user: add directly as member (previous behavior).
      const existing = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: target.id } },
      });
      if (existing) {
        return rep.code(409).send({ message: 'User is already a member' });
      }

      let created;
      try {
        created = await prisma.workspaceMember.create({
          data: {
            id: randomUUID(),
            workspaceId: id,
            userId: target.id,
            role: parsed.data.role,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return rep.code(409).send({ error: 'alreadyMember' });
        }
        throw err;
      }
      await emitEvent(prisma, {
        workspaceId: id,
        projectId: null,
        userId: req.user!.id,
        type: 'workspace.member.invited',
        payload: { email: target.email, userId: target.id, role: created.role },
      });
      return rep.code(201).send({
        kind: 'member' as const,
        member: {
          id: created.id,
          workspaceId: created.workspaceId,
          userId: created.userId,
          role: created.role as WorkspaceRole,
        },
      });
    }

    // No existing user: create an email invite.
    if (!isMultiUser) {
      return rep.code(410).send({ message: 'Email invites disabled in single-user mode' });
    }
    const now = new Date();
    const existingAny = await prisma.invite.findFirst({
      where: {
        workspaceId: id,
        email: targetEmail,
      },
    });
    if (existingAny) {
      const isStale =
        existingAny.acceptedAt !== null || existingAny.expiresAt.getTime() <= now.getTime();
      if (isStale) {
        await prisma.invite.delete({ where: { id: existingAny.id } });
      } else {
        return rep.code(409).send({
          message: 'A pending invite for this email already exists',
          invite: {
            id: existingAny.id,
            expiresAt: existingAny.expiresAt.toISOString(),
          },
        });
      }
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    let invite;
    try {
      invite = await prisma.invite.create({
        data: {
          id: randomUUID(),
          workspaceId: id,
          email: targetEmail,
          role: parsed.data.role,
          token,
          invitedById: req.user!.id,
          expiresAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return rep.code(409).send({ error: 'invitePending' });
      }
      throw err;
    }
    await emitEvent(prisma, {
      workspaceId: id,
      projectId: null,
      userId: req.user!.id,
      type: 'workspace.invite.created',
      payload: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      },
    });
    return rep.code(201).send({
      kind: 'invite' as const,
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role as WorkspaceRole,
        token: invite.token,
        expiresAt: invite.expiresAt.toISOString(),
      },
    });
  });

  // List pending invites for a workspace (admin+ only).
  app.get('/api/workspaces/:id/invites', async (req, rep) => {
    if (!isMultiUser) return rep.code(410).send({ message: 'Invites disabled in single-user mode' });
    const id = (req.params as { id: string }).id;
    const access = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });
    if (!canManageMembersFn(access.role)) {
      return rep.code(403).send({ message: 'Only admins can view invites' });
    }
    const now = new Date();
    const rows = await prisma.invite.findMany({
      where: {
        workspaceId: id,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
      include: { invitedBy: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const out: InviteRecord[] = rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      email: r.email,
      role: r.role as InviteRecord['role'],
      invitedById: r.invitedById,
      invitedByEmail: r.invitedBy?.email ?? null,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
    return out;
  });

  // Revoke a pending invite (admin+ only).
  app.delete('/api/invites/:inviteId', async (req, rep) => {
    if (!isMultiUser) return rep.code(410).send({ message: 'Invites disabled in single-user mode' });
    const inviteId = (req.params as { inviteId: string }).inviteId;
    const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
    if (!invite) return rep.code(404).send({ message: 'Invite not found' });
    const access = await assertWorkspaceAccess(prisma, invite.workspaceId, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Invite not found' });
    if (!canManageMembersFn(access.role)) {
      return rep.code(403).send({ message: 'Only admins can revoke invites' });
    }
    if (invite.acceptedAt) {
      return rep.code(400).send({ message: 'Invite already accepted' });
    }
    await prisma.invite.delete({ where: { id: inviteId } });
    await emitEvent(prisma, {
      workspaceId: invite.workspaceId,
      projectId: null,
      userId: req.user!.id,
      type: 'workspace.invite.revoked',
      payload: { id: invite.id, email: invite.email },
    });
    return rep.code(204).send();
  });

  // Public: preview an invite by token (no auth).
  app.get('/api/invites/token/:token', async (req, rep) => {
    if (!isMultiUser) return rep.code(410).send({ message: 'Invites disabled in single-user mode' });
    const token = (req.params as { token: string }).token;
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { workspace: { select: { name: true } } },
    });
    const now = new Date();
    if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= now.getTime()) {
      return rep.code(404).send({ message: 'Invite not found' });
    }
    const preview: InvitePreview = {
      workspaceName: invite.workspace.name,
      role: invite.role as InvitePreview['role'],
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
    };
    return preview;
  });

  // Public: accept an invite. Creates the user (if not existing) or verifies
  // the password (if the email already has an account), adds them to the
  // workspace, marks the invite accepted, and logs them in.
  app.post('/api/invites/accept', async (req, rep) => {
    if (!isMultiUser) return rep.code(410).send({ message: 'Invites disabled in single-user mode' });
    const parsed = inviteAcceptSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const { token, password, name } = parsed.data;

    const invite = await prisma.invite.findUnique({ where: { token } });
    const now = new Date();
    if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= now.getTime()) {
      return rep.code(404).send({ message: 'Invite not found' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email },
    });

    let userId: string;
    let userEmail: string;
    let userName: string | null;

    if (existingUser) {
      if (!password) {
        return rep.code(400).send({ message: 'password required' });
      }
      const ok = await verifyPassword(password, existingUser.passwordHash);
      if (!ok) return rep.code(401).send({ message: 'incorrect password' });
      userId = existingUser.id;
      userEmail = existingUser.email;
      userName = existingUser.name;
    } else {
      if (!password || password.length < 8) {
        return rep
          .code(400)
          .send({ message: 'password required (min 8 chars)' });
      }
      const hash = await hashPassword(password);
      const newId = randomUUID();
      let createdUser;
      try {
        createdUser = await prisma.user.create({
          data: {
            id: newId,
            email: invite.email,
            passwordHash: hash,
            name: name ?? null,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return rep.code(409).send({ error: 'emailTaken' });
        }
        throw err;
      }
      userId = createdUser.id;
      userEmail = createdUser.email;
      userName = createdUser.name;
    }

    // Transaction: mark accepted + add membership. Handle the unlikely race
    // where the user is already a member (e.g. added via another invite).
    await prisma.$transaction(async (tx) => {
      await tx.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), acceptedById: userId },
      });
      const existingMember = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
      });
      if (!existingMember) {
        await tx.workspaceMember.create({
          data: {
            id: randomUUID(),
            workspaceId: invite.workspaceId,
            userId,
            role: invite.role,
          },
        });
      }
    });

    const workspace = await prisma.workspace.findUnique({
      where: { id: invite.workspaceId },
      select: { id: true, name: true },
    });

    await emitEvent(prisma, {
      workspaceId: invite.workspaceId,
      projectId: null,
      userId,
      type: 'workspace.invite.accepted',
      payload: { id: invite.id, email: invite.email, userId },
    });

    const session = await createSession(prisma, userId);
    rep.setCookie(sessionCookieName, session.id, buildSessionCookieOptions(isProd));
    return rep.code(200).send({
      user: { id: userId, email: userEmail, name: userName },
      workspace: { id: workspace!.id, name: workspace!.name },
      role: invite.role as WorkspaceRole,
    });
  });

  // Change a member's role (admin+ only).
  app.put('/api/workspaces/:id/members/:userId', async (req, rep) => {
    const { id, userId: targetUserId } = req.params as { id: string; userId: string };
    const parsed = memberRoleChangeSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const { role: newRole } = parsed.data;

    const caller = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!caller) return rep.code(404).send({ message: 'Not found' });
    if (!canManageMembersFn(caller.role)) {
      return rep.code(403).send({ message: 'Only admins can change member roles' });
    }

    if (newRole === 'owner') {
      return rep.code(400).send({
        message: 'Use the transfer endpoint to change the workspace owner',
      });
    }

    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } },
      include: { user: { select: { email: true } } },
    });
    if (!target) return rep.code(404).send({ message: 'Member not found' });

    if (target.role === 'owner') {
      return rep.code(400).send({
        message: 'Owner must transfer ownership first',
      });
    }

    // Only the owner can change another admin's role. Self-changes (e.g. an
    // admin demoting themselves) are still allowed.
    if (
      target.role === 'admin' &&
      target.userId !== req.user!.id &&
      !isOwner(caller.role)
    ) {
      return rep.code(403).send({ error: 'ownerOnly' });
    }

    const fromRole = target.role as WorkspaceRole;
    if (fromRole === newRole) {
      return rep.code(200).send({
        userId: target.userId,
        email: target.user.email,
        role: newRole,
      });
    }

    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } },
      data: { role: newRole },
    });
    await emitEvent(prisma, {
      workspaceId: id,
      projectId: null,
      userId: req.user!.id,
      type: 'workspace.member.role_changed',
      payload: {
        userId: targetUserId,
        email: target.user.email,
        fromRole,
        toRole: newRole,
      },
    });
    return rep.code(200).send({
      userId: target.userId,
      email: target.user.email,
      role: newRole,
    });
  });

  // Transfer ownership to another existing member.
  app.post('/api/workspaces/:id/transfer', async (req, rep) => {
    const { id } = req.params as { id: string };
    const parsed = ownershipTransferSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const newOwnerId = parsed.data.userId;

    const caller = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!caller) return rep.code(404).send({ message: 'Not found' });
    if (!isOwner(caller.role)) {
      return rep.code(403).send({ message: 'Only the owner can transfer ownership' });
    }

    if (newOwnerId === req.user!.id) {
      return rep.code(400).send({ message: 'Target is already the owner' });
    }

    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId: newOwnerId } },
      include: { user: { select: { email: true } } },
    });
    if (!target) return rep.code(404).send({ message: 'Member not found' });

    const oldOwnerId = req.user!.id;
    await prisma.$transaction(async (tx) => {
      await tx.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: id, userId: oldOwnerId } },
        data: { role: 'admin' },
      });
      await tx.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: id, userId: newOwnerId } },
        data: { role: 'owner' },
      });
    });
    await emitEvent(prisma, {
      workspaceId: id,
      projectId: null,
      userId: oldOwnerId,
      type: 'workspace.owner.transferred',
      payload: {
        fromUserId: oldOwnerId,
        toUserId: newOwnerId,
        email: target.user.email,
      },
    });
    return rep.code(200).send({
      newOwnerId,
      email: target.user.email,
    });
  });

  app.delete('/api/workspaces/:id/members/:userId', async (req, rep) => {
    const { id, userId: targetUserId } = req.params as { id: string; userId: string };
    const callerId = req.user!.id;
    const caller = await assertWorkspaceAccess(prisma, id, callerId);
    if (!caller) return rep.code(404).send({ message: 'Not found' });

    const isSelf = callerId === targetUserId;
    if (!isSelf && !canManageMembersFn(caller.role)) {
      return rep.code(403).send({ message: 'Only admins can remove members' });
    }

    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } },
    });
    if (!target) return rep.code(404).send({ message: 'Member not found' });

    if (target.role === 'owner') {
      return rep.code(400).send({
        message: 'Owner must transfer ownership first',
      });
    }

    // Only the owner can remove another admin. Self-removal is still allowed.
    if (target.role === 'admin' && !isSelf && !isOwner(caller.role)) {
      return rep.code(403).send({ error: 'ownerOnly' });
    }

    // Load target user email before delete so the event can display it.
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { email: true },
    });
    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } },
    });

    // Force-disconnect any live WebSocket sessions the removed member still
    // has on this workspace; otherwise their open sockets would keep
    // receiving broadcasts until the client noticed and closed.
    const orphanedSockets = presence.getSocketsForUser(id, targetUserId);
    for (const ws of orphanedSockets) {
      try { ws.close?.(4403, 'removed from workspace'); } catch { /* ignore */ }
      broadcaster.removeClient(id, ws);
    }

    await emitEvent(prisma, {
      workspaceId: id,
      projectId: null,
      userId: req.user!.id,
      type: 'workspace.member.removed',
      payload: { userId: targetUserId, email: targetUser?.email ?? null },
    });
    return rep.code(204).send();
  });

  // ---------------- Working calendar ----------------

  app.get('/api/workspaces/:id/calendar', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const access = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });
    const cal = await ensureWorkspaceCalendar(prisma, id);
    const holidays = await prisma.holiday.findMany({
      where: { calendarId: cal.id },
      orderBy: { date: 'asc' },
    });
    return toWorkingCalendarShape(cal, holidays);
  });

  app.put('/api/workspaces/:id/calendar', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const access = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });
    if (!canManageWorkspace(access.role)) {
      return rep.code(403).send({ message: 'Only admins can edit the calendar' });
    }
    const parsed = calendarPutSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    // Extra belt-and-suspenders validation (matches scheduler semantics).
    try {
      parseWeeklyHoursString(parsed.data.weeklyHours);
    } catch (err) {
      return rep.code(400).send({ message: (err as Error).message });
    }

    const cal = await ensureWorkspaceCalendar(prisma, id);
    const updated = await prisma.workingCalendar.update({
      where: { id: cal.id },
      data: { weeklyHours: parsed.data.weeklyHours },
    });
    const holidays = await prisma.holiday.findMany({
      where: { calendarId: cal.id },
      orderBy: { date: 'asc' },
    });
    await emitEvent(prisma, {
      workspaceId: id,
      projectId: null,
      userId: req.user!.id,
      type: 'workspace.calendar.updated',
      payload: { weeklyHours: parsed.data.weeklyHours },
    });
    return toWorkingCalendarShape(updated, holidays);
  });

  app.get('/api/workspaces/:id/holidays', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const access = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });
    const cal = await ensureWorkspaceCalendar(prisma, id);
    const holidays = await prisma.holiday.findMany({
      where: { calendarId: cal.id },
      orderBy: { date: 'asc' },
    });
    return holidays.map((h) => ({
      id: h.id,
      calendarId: h.calendarId,
      date: h.date,
      name: h.name,
    }));
  });

  app.post('/api/workspaces/:id/holidays', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const access = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });
    if (!canManageWorkspace(access.role)) {
      return rep.code(403).send({ message: 'Only admins can add holidays' });
    }
    const parsed = holidayCreateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const cal = await ensureWorkspaceCalendar(prisma, id);
    try {
      const row = await prisma.holiday.create({
        data: {
          id: randomUUID(),
          calendarId: cal.id,
          date: parsed.data.date,
          name: parsed.data.name,
        },
      });
      await emitEvent(prisma, {
        workspaceId: id,
        projectId: null,
        userId: req.user!.id,
        type: 'workspace.holiday.added',
        payload: { id: row.id, date: row.date, name: row.name },
      });
      return rep.code(201).send({
        id: row.id,
        calendarId: row.calendarId,
        date: row.date,
        name: row.name,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return rep.code(409).send({ message: 'Holiday on that date already exists' });
      }
      req.log.error(err);
      return rep.code(500).send({ message: 'Failed to create holiday' });
    }
  });

  app.delete('/api/holidays/:hId', async (req, rep) => {
    const hId = (req.params as { hId: string }).hId;
    const holiday = await prisma.holiday.findUnique({ where: { id: hId } });
    if (!holiday) return rep.code(404).send({ message: 'Holiday not found' });
    const cal = await prisma.workingCalendar.findUnique({
      where: { id: holiday.calendarId },
    });
    if (!cal) return rep.code(404).send({ message: 'Holiday not found' });
    const access = await assertWorkspaceAccess(
      prisma,
      cal.workspaceId,
      req.user!.id
    );
    if (!access) return rep.code(404).send({ message: 'Holiday not found' });
    if (!canManageWorkspace(access.role)) {
      return rep.code(403).send({ message: 'Only admins can remove holidays' });
    }
    await prisma.holiday.delete({ where: { id: hId } });
    await emitEvent(prisma, {
      workspaceId: cal.workspaceId,
      projectId: null,
      userId: req.user!.id,
      type: 'workspace.holiday.removed',
      payload: { id: holiday.id, date: holiday.date, name: holiday.name },
    });
    return rep.code(204).send();
  });

  // Projects
  app.get('/api/projects', async (req, rep) => {
    const userId = req.user!.id;
    const parsed = projectListQuerySchema.safeParse(req.query);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));

    if (parsed.data.workspaceId) {
      const access = await assertWorkspaceAccess(prisma, parsed.data.workspaceId, userId);
      if (!access) return rep.code(404).send({ message: 'Not found' });
      const rows = await prisma.project.findMany({
        where: { workspaceId: parsed.data.workspaceId },
      });
      return rows.map(toProject);
    }

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const wsIds = memberships.map((m) => m.workspaceId);
    if (wsIds.length === 0) return [];
    const rows = await prisma.project.findMany({
      where: { workspaceId: { in: wsIds } },
    });
    return rows.map(toProject);
  });

  app.post('/api/projects', async (req, rep) => {
    const parsed = projectCreateExtendedSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));

    let workspaceId = parsed.data.workspaceId;
    if (!workspaceId) {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { defaultWorkspaceId: true },
      });
      if (!user?.defaultWorkspaceId) {
        return rep.code(400).send({ message: 'No default workspace for user' });
      }
      workspaceId = user.defaultWorkspaceId;
    }
    const wsAccess = await assertWorkspaceAccess(prisma, workspaceId, req.user!.id);
    if (!wsAccess) return rep.code(403).send({ message: 'Forbidden' });
    if (!canWrite(wsAccess.role)) {
      return rep.code(403).send({ message: 'Forbidden: write access required' });
    }

    const now = new Date();
    const startDate = parsed.data.startDate ? new Date(parsed.data.startDate) : now;
    const row = await prisma.project.create({
      data: {
        id: randomUUID(),
        name: parsed.data.name,
        description: parsed.data.description ?? '',
        type: parsed.data.type,
        mode: parsed.data.mode,
        createdAt: now,
        updatedAt: now,
        startDate,
        workspaceId,
      },
    });
    await emitEvent(prisma, {
      workspaceId,
      projectId: row.id,
      userId: req.user!.id,
      type: 'project.created',
      payload: { id: row.id, name: row.name },
    });
    return rep.code(201).send(toProject(row));
  });

  app.get('/api/projects/:id', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const owned = await assertProjectAccess(prisma, id, req.user!.id);
    if (!owned) return rep.code(404).send({ message: 'Not found' });
    return toProject(owned.project);
  });

  app.put('/api/projects/:id', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const parsed = projectUpdateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));

    const owned = await requireProjectWrite(id, req.user!.id, rep);
    if (!owned) return;

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.type !== undefined) data.type = parsed.data.type;
    if (parsed.data.mode !== undefined) data.mode = parsed.data.mode;
    if (parsed.data.startDate !== undefined) data.startDate = new Date(parsed.data.startDate);

    const row = await prisma.project.update({ where: { id }, data });
    await emitEvent(prisma, {
      workspaceId: owned.project.workspaceId,
      projectId: row.id,
      userId: req.user!.id,
      type: 'project.updated',
      payload: { id: row.id, changed: parsed.data },
    });
    return toProject(row);
  });

  app.delete('/api/projects/:id', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const owned = await requireProjectWrite(id, req.user!.id, rep);
    if (!owned) return;

    // Capture name + workspace BEFORE delete so the event payload survives
    // even though the project row will be gone. The Event row uses
    // onDelete: SetNull on its projectId, so the event stays in the
    // workspace activity feed indefinitely.
    const name = owned.project.name;
    const workspaceId = owned.project.workspaceId;

    await prisma.project.delete({ where: { id } });
    await emitEvent(prisma, {
      workspaceId,
      projectId: null,
      userId: req.user!.id,
      type: 'project.deleted',
      payload: { id, name },
    });
    return rep.code(204).send();
  });

  // Tasks
  app.get('/api/projects/:id/tasks', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const owned = await assertProjectAccess(prisma, id, req.user!.id);
    if (!owned) return rep.code(404).send({ message: 'Not found' });
    const rows = await prisma.task.findMany({ where: { projectId: id } });
    // Derive hasChildren in a single groupBy (cheap, indexed) so the client
    // can hide parent rows from /now and render the chevron without N+1.
    const childCounts = await prisma.task.groupBy({
      by: ['parentTaskId'],
      where: { projectId: id, parentTaskId: { not: null } },
      _count: { _all: true },
    });
    const parentSet = new Set(
      childCounts.map((c) => c.parentTaskId).filter((x): x is string => !!x)
    );
    return rows.map((r) => toTask(r, parentSet.has(r.id)));
  });

  app.post('/api/projects/:id/tasks', async (req, rep) => {
    const projectId = (req.params as { id: string }).id;
    const owned = await requireProjectWrite(projectId, req.user!.id, rep);
    if (!owned) return;

    const parsed = taskCreateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const body = parsed.data;

    // Validate parent — same project, no cycle (a freshly-created task with
    // no children can't form one but the parent chain itself might be at
    // depth limit), no cross-project parent.
    if (body.parentTaskId) {
      const newId = 'new'; // placeholder for self-cycle (impossible on create)
      const check = await checkParentChain(prisma, newId, body.parentTaskId, projectId);
      if (!check.ok) {
        return rep
          .code(400)
          .send({ message: `Invalid parentTaskId (${check.reason})` });
      }
    }

    const existingCount = await prisma.task.count({ where: { projectId } });
    const e = body.estimate ?? {};
    const o = Math.max(1, Math.round(e.o ?? 1));
    const m = Math.max(1, Math.round(e.m ?? e.o ?? 1));
    const p = Math.max(1, Math.round(e.p ?? e.m ?? 1));

    const row = await prisma.task.create({
      data: {
        id: randomUUID(),
        projectId,
        title: body.title,
        type: body.type ?? 'research',
        status: body.status ?? 'todo',
        estimateO: o,
        estimateM: m,
        estimateP: p,
        size: body.size ?? 'm',
        intensity: body.intensity ?? null,
        confidence: e.confidence ?? null,
        priority: typeof body.priority === 'number' ? body.priority : existingCount + 1,
        labels: body.labels ? JSON.stringify(body.labels) : null,
        assignee: body.assignee ?? null,
        dueSoft: body.dueSoft ? new Date(body.dueSoft) : null,
        dueHard: body.dueHard ? new Date(body.dueHard) : null,
        // Timeframe bucket — when set without an explicit anchor, the server
        // anchors to now() so countdown math has a starting point.
        timeframeBucket: body.timeframeBucket ?? null,
        timeframeAnchor: body.timeframeBucket
          ? body.timeframeAnchor
            ? new Date(body.timeframeAnchor)
            : new Date()
          : null,
        milestoneId: body.milestoneId ?? null,
        parentTaskId: body.parentTaskId ?? null,
        notes: body.notes ?? null,
      },
    });
    await touchProject(projectId);
    await emitEvent(prisma, {
      workspaceId: owned.project.workspaceId,
      projectId,
      userId: req.user!.id,
      type: 'task.created',
      payload: { id: row.id, title: row.title, type: row.type, status: row.status },
    });
    return rep.code(201).send(toTask(row));
  });

  // Reorder all tasks in a project. Client sends the desired order as an
  // array of taskIds; server resets `priority = index + 1` for each in a
  // single transaction. Tasks not in the array keep their existing
  // priority unchanged. No event emit (drag-reorder is high-frequency,
  // would spam the activity feed).
  app.post('/api/projects/:id/tasks/reorder', async (req, rep) => {
    const projectId = (req.params as { id: string }).id;
    const owned = await requireProjectWrite(projectId, req.user!.id, rep);
    if (!owned) return;

    const parsed = z
      .object({ taskIds: z.array(z.string().min(1)).max(1000) })
      .safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));

    const { taskIds } = parsed.data;
    // Verify all referenced tasks belong to this project (no cross-project bleed).
    const existing = await prisma.task.findMany({
      where: { id: { in: taskIds }, projectId },
      select: { id: true },
    });
    const existingSet = new Set(existing.map((t) => t.id));
    for (const id of taskIds) {
      if (!existingSet.has(id)) {
        return rep.code(400).send({ message: `Task ${id} not in project` });
      }
    }

    // Single executeRaw with a CASE expression — for 1000 tasks this is one
    // round-trip vs. 1000 with the prior `taskIds.map(prisma.task.update)`
    // approach. Workspace scoping is preserved by the requireProjectWrite
    // check above plus the per-id `projectId` membership verification just
    // run; the IN-list double-guards against any id slipping through.
    if (taskIds.length > 0) {
      const caseFragments = taskIds.map(
        (id, idx) => Prisma.sql`WHEN ${id} THEN ${idx + 1}`
      );
      const caseExpr = Prisma.join(caseFragments, ' ');
      const inList = Prisma.join(taskIds.map((id) => Prisma.sql`${id}`));
      await prisma.$executeRaw`
        UPDATE Task
        SET priority = CASE id ${caseExpr} END
        WHERE id IN (${inList})
          AND projectId = ${projectId}
      `;
    }
    await touchProject(projectId);
    return rep.code(204).send();
  });

  app.put('/api/tasks/:taskId', async (req, rep) => {
    const taskId = (req.params as { taskId: string }).taskId;
    const original = await prisma.task.findUnique({ where: { id: taskId } });
    if (!original) return rep.code(404).send({ message: 'Task not found' });
    const owned = await requireProjectWrite(original.projectId, req.user!.id, rep);
    if (!owned) return;

    const parsed = taskUpdateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const body = parsed.data;

    const nextEstimateO = body.estimate
      ? Math.max(1, Math.round(body.estimate.o ?? original.estimateO))
      : original.estimateO;
    const nextEstimateM = body.estimate
      ? Math.max(1, Math.round(body.estimate.m ?? original.estimateM))
      : original.estimateM;
    const nextEstimateP = body.estimate
      ? Math.max(1, Math.round(body.estimate.p ?? original.estimateP))
      : original.estimateP;
    const nextConfidence = body.estimate
      ? body.estimate.confidence ?? original.confidence
      : original.confidence;

    // Phase F: auto-stamp startedAt/finishedAt on status transitions.
    // Explicit values in `body` (including null) override the auto-set values.
    const nextStatus = body.status ?? original.status;
    const isMovingToDoing =
      body.status === 'doing' && original.status !== 'doing';
    const isMovingToDone =
      body.status === 'done' && original.status !== 'done';
    let autoStartedAt: Date | null = original.startedAt;
    let autoFinishedAt: Date | null = original.finishedAt;
    if (isMovingToDoing && !original.startedAt) {
      autoStartedAt = new Date();
    }
    if (isMovingToDone) {
      if (!original.startedAt) autoStartedAt = new Date();
      if (!original.finishedAt) autoFinishedAt = new Date();
    }
    const finalStartedAt =
      body.startedAt !== undefined
        ? body.startedAt === null
          ? null
          : new Date(body.startedAt)
        : autoStartedAt;
    const finalFinishedAt =
      body.finishedAt !== undefined
        ? body.finishedAt === null
          ? null
          : new Date(body.finishedAt)
        : autoFinishedAt;

    // blockedAt: stamp when entering 'blocked', clear when leaving. Explicit value wins.
    const isMovingToBlocked =
      body.status === 'blocked' && original.status !== 'blocked';
    const isLeavingBlocked =
      original.status === 'blocked' && !!body.status && body.status !== 'blocked';
    let finalBlockedAt: Date | null = original.blockedAt;
    if (body.blockedAt !== undefined) {
      finalBlockedAt = body.blockedAt ? new Date(body.blockedAt) : null;
    } else if (isMovingToBlocked) {
      finalBlockedAt = new Date();
    } else if (isLeavingBlocked) {
      finalBlockedAt = null;
    }

    // Top of Mind: explicit `focusedAt` wins; else `focused: true|false` toggles.
    let finalFocusedAt: Date | null = original.focusedAt;
    if (body.focusedAt !== undefined) {
      finalFocusedAt = body.focusedAt ? new Date(body.focusedAt) : null;
    } else if (body.focused === true && !original.focusedAt) {
      finalFocusedAt = new Date();
    } else if (body.focused === false) {
      finalFocusedAt = null;
    }

    // Subtask: validate parent before write. Walks the parent chain to
    // catch self-cycle, multi-step cycle, depth violation, missing parent,
    // or cross-project parent. Only when parentTaskId is in the body.
    // Pre-flight check outside the tx for fast rejection of obvious bad
    // input; the authoritative re-check happens inside the transaction below
    // to prevent two concurrent reassignments (A→B and B→A) from each
    // passing an independent walk and forming a cycle.
    let nextParentTaskId: string | null = original.parentTaskId;
    if (body.parentTaskId !== undefined) {
      const candidate = body.parentTaskId;
      const check = await checkParentChain(prisma, taskId, candidate, original.projectId);
      if (!check.ok) {
        return rep
          .code(400)
          .send({ message: `Invalid parentTaskId (${check.reason})` });
      }
      nextParentTaskId = candidate;
    }

    type CycleErr = { __cycle: true; reason: 'self' | 'cycle' | 'cross-project' | 'depth' | 'missing' };
    const txResult = await prisma.$transaction(async (tx) => {
      // Re-run the parent walk inside the tx so cycles created by a
      // concurrent reassignment are caught before our write commits.
      if (body.parentTaskId !== undefined) {
        const recheck = await checkParentChain(tx, taskId, body.parentTaskId, original.projectId);
        if (!recheck.ok) {
          const err: CycleErr = { __cycle: true, reason: recheck.reason };
          return err;
        }
      }
      return tx.task.update({
        where: { id: taskId },
        data: {
          title: body.title?.trim() || original.title,
          type: body.type ?? original.type,
          status: nextStatus,
          estimateO: nextEstimateO,
          estimateM: nextEstimateM,
          estimateP: nextEstimateP,
          size: body.size ?? original.size,
          intensity:
            body.intensity !== undefined
              ? body.intensity
              : (original as typeof original & { intensity?: number | null }).intensity ?? null,
          confidence: nextConfidence,
          priority: typeof body.priority === 'number' ? body.priority : original.priority,
          labels:
            body.labels !== undefined
              ? JSON.stringify(body.labels)
              : original.labels,
          assignee: body.assignee !== undefined ? body.assignee : original.assignee,
          startPlanned: body.startPlanned
            ? new Date(body.startPlanned)
            : original.startPlanned,
          endPlanned: body.endPlanned
            ? new Date(body.endPlanned)
            : original.endPlanned,
          startedAt: finalStartedAt,
          finishedAt: finalFinishedAt,
          focusedAt: finalFocusedAt,
          blockedAt: finalBlockedAt,
          dueSoft: body.dueSoft ? new Date(body.dueSoft) : original.dueSoft,
          dueHard: body.dueHard ? new Date(body.dueHard) : original.dueHard,
          // Timeframe update semantics:
          //   - bucket omitted: leave both fields alone
          //   - bucket === null: clear both fields (drop the bucket)
          //   - bucket changed to a new value: keep existing anchor unless caller
          //     supplied a fresh one OR there was no anchor yet (then default to now)
          //   - bucket unchanged, anchor supplied: re-anchor only
          timeframeBucket:
            body.timeframeBucket === null
              ? null
              : body.timeframeBucket !== undefined
                ? body.timeframeBucket
                : (original as typeof original & { timeframeBucket?: string | null })
                    .timeframeBucket ?? null,
          timeframeAnchor:
            body.timeframeBucket === null
              ? null
              : body.timeframeAnchor !== undefined
                ? body.timeframeAnchor
                  ? new Date(body.timeframeAnchor)
                  : null
                : body.timeframeBucket !== undefined
                  ? // bucket explicitly set on this update — pick existing
                    // anchor if present, else stamp now()
                    (original as typeof original & { timeframeAnchor?: Date | null })
                      .timeframeAnchor ?? new Date()
                  : (original as typeof original & { timeframeAnchor?: Date | null })
                      .timeframeAnchor ?? null,
          milestoneId:
            body.milestoneId !== undefined ? body.milestoneId : original.milestoneId,
          parentTaskId: nextParentTaskId,
          notes: body.notes !== undefined ? body.notes : original.notes,
        },
      });
    });
    if ((txResult as CycleErr).__cycle) {
      const err = txResult as CycleErr;
      return rep
        .code(400)
        .send({ message: `Invalid parentTaskId (${err.reason})` });
    }
    const updated = txResult as TaskRow;
    await touchProject(original.projectId);
    const changes = diffFields(
      original as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      [
        'title', 'type', 'status', 'estimateO', 'estimateM', 'estimateP',
        'size', 'intensity', 'confidence', 'priority', 'labels', 'assignee', 'startPlanned',
        'endPlanned', 'dueSoft', 'dueHard', 'timeframeBucket', 'timeframeAnchor',
        'milestoneId', 'parentTaskId', 'notes',
      ] as const
    );
    await emitEvent(prisma, {
      workspaceId: owned.project.workspaceId,
      projectId: original.projectId,
      userId: req.user!.id,
      type: 'task.updated',
      payload: { id: updated.id, title: updated.title, changes },
    });
    return toTask(updated);
  });

  app.delete('/api/tasks/:taskId', async (req, rep) => {
    const taskId = (req.params as { taskId: string }).taskId;
    const original = await prisma.task.findUnique({ where: { id: taskId } });
    if (!original) return rep.code(404).send({ message: 'Task not found' });
    const owned = await requireProjectWrite(original.projectId, req.user!.id, rep);
    if (!owned) return;
    // Cascading delete on Dependency (onDelete: Cascade on Task relations) handles dep cleanup.
    await prisma.task.delete({ where: { id: taskId } });
    await touchProject(original.projectId);
    await emitEvent(prisma, {
      workspaceId: owned.project.workspaceId,
      projectId: original.projectId,
      userId: req.user!.id,
      type: 'task.deleted',
      payload: { id: original.id, title: original.title },
    });
    return rep.code(204).send();
  });

  // Dependencies
  app.get('/api/projects/:id/deps', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const owned = await assertProjectAccess(prisma, id, req.user!.id);
    if (!owned) return rep.code(404).send({ message: 'Not found' });
    const rows = await prisma.dependency.findMany({ where: { projectId: id } });
    return rows.map(toDependency);
  });

  app.post('/api/projects/:id/deps', async (req, rep) => {
    const projectId = (req.params as { id: string }).id;
    const owned = await requireProjectWrite(projectId, req.user!.id, rep);
    if (!owned) return;

    const parsed = dependencyCreateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const { fromTaskId, toTaskId, type, lag } = parsed.data;

    if (fromTaskId === toTaskId) {
      return rep.code(400).send({ message: 'Cannot create self dependency' });
    }

    // Cycle check + insert must be one transaction; otherwise two concurrent
    // POSTs (A→B and B→A) can each pass an independent buildGraph/DFS and
    // produce a cycle once both commit. Re-running the check inside the tx
    // sees a consistent snapshot.
    type DepErr = { __err: true; status: number; body: { message: string } };
    const txResult = await prisma.$transaction(async (tx) => {
      const taskRows = await tx.task.findMany({ where: { projectId } });
      const hasFrom = taskRows.some((t) => t.id === fromTaskId);
      const hasTo = taskRows.some((t) => t.id === toTaskId);
      if (!hasFrom || !hasTo) {
        return { __err: true, status: 400, body: { message: 'Tasks must belong to project' } } as DepErr;
      }
      const depRows = await tx.dependency.findMany({ where: { projectId } });
      const duplicate = depRows.some(
        (d) => d.fromTaskId === fromTaskId && d.toTaskId === toTaskId
      );
      if (duplicate) {
        return { __err: true, status: 400, body: { message: 'Dependency already exists' } } as DepErr;
      }
      const tasks = taskRows.map((r) => toTask(r));
      const deps = depRows.map(toDependency);
      if (wouldCreateCycle(tasks, deps, fromTaskId, toTaskId)) {
        return { __err: true, status: 400, body: { message: 'This dependency would create a cycle' } } as DepErr;
      }
      return tx.dependency.create({
        data: {
          id: randomUUID(),
          projectId,
          fromTaskId,
          toTaskId,
          type,
          lag,
        },
      });
    });
    if ((txResult as DepErr).__err) {
      const err = txResult as DepErr;
      return rep.code(err.status).send(err.body);
    }
    const row = txResult as DependencyRow;
    await touchProject(projectId);
    await emitEvent(prisma, {
      workspaceId: owned.project.workspaceId,
      projectId,
      userId: req.user!.id,
      type: 'dependency.created',
      payload: {
        id: row.id,
        fromTaskId: row.fromTaskId,
        toTaskId: row.toTaskId,
        type: row.type,
        lag: row.lag,
      },
    });
    return rep.code(201).send(toDependency(row));
  });

  app.delete('/api/deps/:depId', async (req, rep) => {
    const depId = (req.params as { depId: string }).depId;
    const existing = await prisma.dependency.findUnique({ where: { id: depId } });
    if (!existing) return rep.code(404).send({ message: 'Dependency not found' });
    const owned = await requireProjectWrite(existing.projectId, req.user!.id, rep);
    if (!owned) return;
    await prisma.dependency.delete({ where: { id: depId } });
    await touchProject(existing.projectId);
    await emitEvent(prisma, {
      workspaceId: owned.project.workspaceId,
      projectId: existing.projectId,
      userId: req.user!.id,
      type: 'dependency.deleted',
      payload: { id: existing.id, fromTaskId: existing.fromTaskId, toTaskId: existing.toTaskId },
    });
    return rep.code(204).send();
  });

  // Milestones
  app.get('/api/projects/:id/milestones', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const owned = await assertProjectAccess(prisma, id, req.user!.id);
    if (!owned) return rep.code(404).send({ message: 'Not found' });
    const rows = await prisma.milestone.findMany({ where: { projectId: id } });
    return rows.map(toMilestone);
  });

  app.post('/api/projects/:id/milestones', async (req, rep) => {
    const projectId = (req.params as { id: string }).id;
    const owned = await requireProjectWrite(projectId, req.user!.id, rep);
    if (!owned) return;

    const parsed = milestoneCreateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const body = parsed.data;

    const row = await prisma.milestone.create({
      data: {
        id: randomUUID(),
        projectId,
        title: body.title,
        criteria: body.criteria ?? null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        dueSoft: body.dueSoft ? new Date(body.dueSoft) : null,
        dueHard: body.dueHard ? new Date(body.dueHard) : null,
      },
    });
    await touchProject(projectId);
    await emitEvent(prisma, {
      workspaceId: owned.project.workspaceId,
      projectId,
      userId: req.user!.id,
      type: 'milestone.created',
      payload: { id: row.id, title: row.title },
    });
    return rep.code(201).send(toMilestone(row));
  });

  app.put('/api/milestones/:mId', async (req, rep) => {
    const mId = (req.params as { mId: string }).mId;
    const parsed = milestoneUpdateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const body = parsed.data;

    const original = await prisma.milestone.findUnique({ where: { id: mId } });
    if (!original) return rep.code(404).send({ message: 'Milestone not found' });
    const owned = await requireProjectWrite(original.projectId, req.user!.id, rep);
    if (!owned) return;

    const updated = await prisma.milestone.update({
      where: { id: mId },
      data: {
        title: body.title?.trim() || original.title,
        criteria: body.criteria !== undefined ? body.criteria : original.criteria,
        startDate: body.startDate ? new Date(body.startDate) : original.startDate,
        dueSoft: body.dueSoft ? new Date(body.dueSoft) : original.dueSoft,
        dueHard: body.dueHard ? new Date(body.dueHard) : original.dueHard,
      },
    });
    await touchProject(original.projectId);
    const changes = diffFields(
      original as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      ['title', 'criteria', 'startDate', 'dueSoft', 'dueHard'] as const
    );
    await emitEvent(prisma, {
      workspaceId: owned.project.workspaceId,
      projectId: original.projectId,
      userId: req.user!.id,
      type: 'milestone.updated',
      payload: { id: updated.id, title: updated.title, changes },
    });
    return toMilestone(updated);
  });

  app.delete('/api/milestones/:mId', async (req, rep) => {
    const mId = (req.params as { mId: string }).mId;
    const original = await prisma.milestone.findUnique({ where: { id: mId } });
    if (!original) return rep.code(404).send({ message: 'Milestone not found' });
    const owned = await requireProjectWrite(original.projectId, req.user!.id, rep);
    if (!owned) return;
    // onDelete: SetNull on Task.milestoneId handles detaching tasks automatically.
    await prisma.milestone.delete({ where: { id: mId } });
    await touchProject(original.projectId);
    await emitEvent(prisma, {
      workspaceId: owned.project.workspaceId,
      projectId: original.projectId,
      userId: req.user!.id,
      type: 'milestone.deleted',
      payload: { id: original.id, title: original.title },
    });
    return rep.code(204).send();
  });

  // Schedule
  app.post('/api/projects/:id/schedule', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const owned = await assertProjectAccess(prisma, id, req.user!.id);
    if (!owned) return rep.code(404).send({ message: 'Not found' });
    const project = owned.project;

    const parsed = scheduleRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const durationMode: DurationMode = parsed.data.durationMode ?? 'expected';

    const taskRows = await prisma.task.findMany({ where: { projectId: id } });
    const depRows = await prisma.dependency.findMany({ where: { projectId: id } });
    const tasks = taskRows.map((r) => toTask(r));
    const deps = depRows.map(toDependency);
    const start = project.startDate ? project.startDate : new Date();
    const calendar = await loadCalendarDescriptorForWorkspace(
      prisma,
      project.workspaceId
    );
    try {
      return schedule(tasks, deps, {
        projectId: id,
        projectStart: start,
        durationMode,
        calendar,
      });
    } catch (err) {
      if (err instanceof CycleError) {
        return rep
          .code(409)
          .send({ message: 'Dependency graph contains a cycle.' });
      }
      req.log.error(err);
      return rep.code(500).send({ message: 'Failed to compute schedule' });
    }
  });

  // Scenarios
  app.get('/api/projects/:id/scenarios', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const owned = await assertProjectAccess(prisma, id, req.user!.id);
    if (!owned) return rep.code(404).send({ message: 'Not found' });
    const rows = await prisma.scenario.findMany({ where: { projectId: id } });
    return rows.map(toScenario);
  });

  app.post('/api/projects/:id/scenarios', async (req, rep) => {
    const projectId = (req.params as { id: string }).id;
    const owned = await requireProjectWrite(projectId, req.user!.id, rep);
    if (!owned) return;
    const project = owned.project;

    const parsed = scenarioCreateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const { name, durationMode } = parsed.data;

    const taskRows = await prisma.task.findMany({ where: { projectId } });
    const depRows = await prisma.dependency.findMany({ where: { projectId } });
    const tasks = taskRows.map((r) => toTask(r));
    const deps = depRows.map(toDependency);
    const start = project.startDate ? project.startDate : new Date();

    const calendar = await loadCalendarDescriptorForWorkspace(
      prisma,
      owned.project.workspaceId
    );
    try {
      const snapshot = schedule(tasks, deps, {
        projectId,
        projectStart: start,
        durationMode,
        calendar,
      });
      const row = await prisma.scenario.create({
        data: {
          id: randomUUID(),
          projectId,
          name,
          durationMode,
          createdAt: new Date(),
          snapshot: JSON.stringify(snapshot),
        },
      });
      await touchProject(projectId);
      await emitEvent(prisma, {
        workspaceId: owned.project.workspaceId,
        projectId,
        userId: req.user!.id,
        type: 'scenario.created',
        payload: { id: row.id, name: row.name, durationMode: row.durationMode },
      });
      return rep.code(201).send(toScenario(row));
    } catch (err) {
      if (err instanceof CycleError) {
        return rep
          .code(409)
          .send({ message: 'Dependency graph contains a cycle.' });
      }
      req.log.error(err);
      return rep.code(500).send({ message: 'Failed to compute schedule' });
    }
  });

  app.delete('/api/scenarios/:sId', async (req, rep) => {
    const sId = (req.params as { sId: string }).sId;
    const existing = await prisma.scenario.findUnique({ where: { id: sId } });
    if (!existing) return rep.code(404).send({ message: 'Scenario not found' });
    const owned = await requireProjectWrite(existing.projectId, req.user!.id, rep);
    if (!owned) return;
    await prisma.scenario.delete({ where: { id: sId } });
    await touchProject(existing.projectId);
    await emitEvent(prisma, {
      workspaceId: owned.project.workspaceId,
      projectId: existing.projectId,
      userId: req.user!.id,
      type: 'scenario.deleted',
      payload: { id: existing.id, name: existing.name },
    });
    return rep.code(204).send();
  });

  // ---------------- Notes (quick capture / inbox) ----------------

  // Create a note. projectId is optional — null/undefined means "inbox".
  app.post('/api/notes', async (req, rep) => {
    const parsed = noteCreateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const { workspaceId, projectId, body: rawBody, tags } = parsed.data;
    const body = rawBody.trim();
    if (!body) return rep.code(400).send({ message: 'body cannot be empty' });

    const access = await assertWorkspaceAccess(prisma, workspaceId, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });

    // If filing to a project, verify it lives in this workspace.
    let projectName: string | null = null;
    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project || project.workspaceId !== workspaceId) {
        return rep.code(400).send({ message: 'project not in workspace' });
      }
      projectName = project.name;
    }

    const finalTags = mergeTags(tags, body);
    const row = await prisma.note.create({
      data: {
        id: randomUUID(),
        workspaceId,
        projectId: projectId ?? null,
        createdById: req.user!.id,
        body,
        tags: JSON.stringify(finalTags),
      },
      include: { createdBy: { select: { email: true } } },
    });

    // Project notes are visible in activity; inbox captures stay private.
    if (projectId) {
      await emitEvent(prisma, {
        workspaceId,
        projectId,
        userId: req.user!.id,
        type: 'note.created',
        payload: { id: row.id, project: projectName ?? '' },
      });
    }

    return rep.code(201).send(toNote(row));
  });

  // List notes for a project (any workspace member).
  app.get('/api/projects/:id/notes', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const access = await assertProjectAccess(prisma, id, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });

    const parsed = noteListQuerySchema.safeParse(req.query);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const limit = parsed.data.limit ?? 50;
    const before = parsed.data.before ? new Date(parsed.data.before) : undefined;

    const rows = await prisma.note.findMany({
      where: {
        projectId: id,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: { createdBy: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toNote);
  });

  // The caller's inbox in a workspace (notes with projectId=null and
  // createdById=req.user.id). Other members' inbox notes never leak.
  app.get('/api/workspaces/:id/inbox', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const access = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });

    const parsed = noteListQuerySchema.safeParse(req.query);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const limit = parsed.data.limit ?? 50;
    const before = parsed.data.before ? new Date(parsed.data.before) : undefined;

    const rows = await prisma.note.findMany({
      where: {
        workspaceId: id,
        projectId: null,
        createdById: req.user!.id,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: { createdBy: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toNote);
  });

  // Update a note — author only. Setting projectId moves the note (file
  // action). We re-extract hashtags whenever the body changes.
  app.put('/api/notes/:noteId', async (req, rep) => {
    const noteId = (req.params as { noteId: string }).noteId;
    const original = await prisma.note.findUnique({ where: { id: noteId } });
    if (!original) return rep.code(404).send({ message: 'Note not found' });
    if (original.createdById !== req.user!.id) {
      return rep.code(403).send({ message: 'Only the author can edit this note' });
    }

    const parsed = noteUpdateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const { body: rawBody, tags, projectId } = parsed.data;

    let nextProjectId: string | null = original.projectId;
    let projectName: string | null = null;
    if (projectId !== undefined) {
      if (projectId === null) {
        nextProjectId = null;
      } else {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project || project.workspaceId !== original.workspaceId) {
          return rep.code(400).send({ message: 'project not in workspace' });
        }
        nextProjectId = projectId;
        projectName = project.name;
      }
    }

    const nextBody = rawBody !== undefined ? rawBody.trim() : original.body;
    if (!nextBody) return rep.code(400).send({ message: 'body cannot be empty' });

    // Recompute tags whenever body or explicit tags changed.
    const bodyChanged = rawBody !== undefined && nextBody !== original.body;
    const explicitTags =
      tags !== undefined ? tags : bodyChanged ? parseTags(original.tags) : undefined;
    const nextTagsJson =
      tags !== undefined || bodyChanged
        ? JSON.stringify(mergeTags(explicitTags, nextBody))
        : original.tags;

    const updated = await prisma.note.update({
      where: { id: noteId },
      data: {
        body: nextBody,
        tags: nextTagsJson,
        projectId: nextProjectId,
      },
      include: { createdBy: { select: { email: true } } },
    });

    // Only emit when filing into a project (high-signal event); skip body-edits
    // and unfile-to-inbox.
    const filedIntoProject =
      projectId !== undefined &&
      projectId !== null &&
      original.projectId !== nextProjectId;
    if (filedIntoProject) {
      await emitEvent(prisma, {
        workspaceId: original.workspaceId,
        projectId: nextProjectId,
        userId: req.user!.id,
        type: 'note.updated',
        payload: { id: updated.id, project: projectName ?? '' },
      });
    }

    return toNote(updated);
  });

  // Delete a note — author only.
  app.delete('/api/notes/:noteId', async (req, rep) => {
    const noteId = (req.params as { noteId: string }).noteId;
    const original = await prisma.note.findUnique({ where: { id: noteId } });
    if (!original) return rep.code(404).send({ message: 'Note not found' });
    if (original.createdById !== req.user!.id) {
      return rep.code(403).send({ message: 'Only the author can delete this note' });
    }
    await prisma.note.delete({ where: { id: noteId } });
    return rep.code(204).send();
  });

  // Promote a note to a Task in a target project, then delete the note.
  // Caller must have write access on the target project.
  app.post('/api/notes/:noteId/promote-to-task', async (req, rep) => {
    const noteId = (req.params as { noteId: string }).noteId;
    const parsed = notePromoteSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const { projectId } = parsed.data;

    const original = await prisma.note.findUnique({ where: { id: noteId } });
    if (!original) return rep.code(404).send({ message: 'Note not found' });
    // Author can only promote their own notes (notes are personal until filed).
    if (original.createdById !== req.user!.id) {
      return rep.code(403).send({ message: 'Only the author can promote this note' });
    }

    const access = await assertProjectAccess(prisma, projectId, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Project not found' });
    if (!canWrite(access.role)) {
      return rep.code(403).send({ message: 'Forbidden: write access required' });
    }
    if (access.project.workspaceId !== original.workspaceId) {
      return rep.code(400).send({ message: 'project not in workspace' });
    }

    const title = original.body.slice(0, 80).trim() || 'Untitled';
    const existingCount = await prisma.task.count({ where: { projectId } });

    const newTaskRow = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          id: randomUUID(),
          projectId,
          title,
          type: 'thinking',
          status: 'todo',
          estimateO: 1,
          estimateM: 1,
          estimateP: 1,
          size: 'm',
          confidence: null,
          priority: existingCount + 1,
          // Preserve note tags as task labels. Both columns store a JSON
          // string of `string[]`; treat "[]" as no labels (null).
          labels: original.tags && original.tags !== '[]' ? original.tags : null,
          assignee: null,
          dueSoft: null,
          dueHard: null,
          milestoneId: null,
          notes: original.body,
        },
      });
      await tx.note.delete({ where: { id: noteId } });
      return created;
    });

    await touchProject(projectId);
    await emitEvent(prisma, {
      workspaceId: access.project.workspaceId,
      projectId,
      userId: req.user!.id,
      type: 'task.created',
      payload: {
        id: newTaskRow.id,
        title: newTaskRow.title,
        type: newTaskRow.type,
        status: newTaskRow.status,
      },
    });

    return rep.code(201).send(toTask(newTaskRow));
  });

  // ---------------- Activity feed ----------------

  app.get('/api/workspaces/:id/activity', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const access = await assertWorkspaceAccess(prisma, id, req.user!.id);
    if (!access) return rep.code(404).send({ message: 'Not found' });

    const parsed = activityQuerySchema.safeParse(req.query);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const limit = parsed.data.limit ?? 50;
    const before = parsed.data.before ? new Date(parsed.data.before) : undefined;

    const rows = await prisma.event.findMany({
      where: {
        workspaceId: id,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(serializeEvent);
  });

  app.get('/api/projects/:id/activity', async (req, rep) => {
    const id = (req.params as { id: string }).id;
    const owned = await assertProjectAccess(prisma, id, req.user!.id);
    if (!owned) return rep.code(404).send({ message: 'Not found' });

    const parsed = activityQuerySchema.safeParse(req.query);
    if (!parsed.success) return rep.code(400).send(zodErrorPayload(parsed.error));
    const limit = parsed.data.limit ?? 50;
    const before = parsed.data.before ? new Date(parsed.data.before) : undefined;

    const rows = await prisma.event.findMany({
      where: {
        projectId: id,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(serializeEvent);
  });

  // Cross-entity search. Substring-match against project names/descriptions,
  // task titles, and note bodies/tags across every workspace the caller is a
  // member of. Each bucket capped at 50 rows. SQLite `contains` is
  // case-sensitive in Prisma's SQLite provider, so matching is exact-case
  // for v1 — fine for typical lowercased search input.
  // TODO: switch to FTS5 virtual tables if workspaces grow past ~10k rows
  // (notes/tasks). For now `LIKE %q%` on indexed-by-workspace tables is
  // plenty for hundreds-to-low-thousands.
  app.get('/api/search', async (req, rep) => {
    const q = String((req.query as { q?: unknown })?.q ?? '').trim();
    if (q.length > 200) return rep.code(400).send({ error: 'queryTooLong' });
    const empty = { query: q, tasks: [], notes: [], projects: [] };
    if (q.length === 0) return empty;
    const userId = req.user!.id;
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);
    if (workspaceIds.length === 0) return empty;

    const [projects, tasks, noteRows] = await Promise.all([
      prisma.project.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          OR: [
            { name: { contains: q } },
            { description: { contains: q } },
          ],
        },
        take: 50,
        select: { id: true, name: true, type: true, description: true },
      }),
      prisma.task.findMany({
        where: {
          project: { workspaceId: { in: workspaceIds } },
          title: { contains: q },
        },
        take: 50,
        select: {
          id: true,
          projectId: true,
          title: true,
          status: true,
          size: true,
          priority: true,
          dueSoft: true,
          dueHard: true,
        },
      }),
      prisma.note.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          OR: [
            { body: { contains: q } },
            // tags is JSON-encoded; substring match against the raw column
            // is good enough for tag hits like #foo.
            { tags: { contains: q } },
          ],
        },
        take: 50,
        select: {
          id: true,
          projectId: true,
          body: true,
          tags: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      query: q,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        type: (p.type ?? 'other') as Project['type'],
        description: p.description ?? '',
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        title: t.title,
        status: t.status as Task['status'],
        size: t.size as TaskSize,
        priority: t.priority,
        dueSoft: isoOrUndef(t.dueSoft),
        dueHard: isoOrUndef(t.dueHard),
      })),
      notes: noteRows.map((n) => ({
        id: n.id,
        projectId: n.projectId,
        body: n.body,
        tags: parseTags(n.tags),
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });

  // Backup endpoint: returns every row of every workspace-scoped table the
  // current user can see, as a single JSON document. Sessions and invites
  // are intentionally excluded. Auth is enforced by the global preHandler;
  // works in both single-user and multi-user modes (multi-user clients still
  // need a valid session cookie).
  app.get('/api/admin/dump', async (req, rep) => {
    const userId = req.user!.id;

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true, role: true, createdAt: true, id: true, userId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    const [user, workspaces, projects, tasks, dependencies, milestones, notes, scenarios, events] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, name: true, createdAt: true },
        }),
        prisma.workspace.findMany({ where: { id: { in: workspaceIds } } }),
        prisma.project.findMany({ where: { workspaceId: { in: workspaceIds } } }),
        prisma.task.findMany({
          where: { project: { workspaceId: { in: workspaceIds } } },
        }),
        prisma.dependency.findMany({
          where: { project: { workspaceId: { in: workspaceIds } } },
        }),
        prisma.milestone.findMany({
          where: { project: { workspaceId: { in: workspaceIds } } },
        }),
        prisma.note.findMany({ where: { workspaceId: { in: workspaceIds } } }),
        prisma.scenario.findMany({
          where: { project: { workspaceId: { in: workspaceIds } } },
        }),
        prisma.event.findMany({ where: { workspaceId: { in: workspaceIds } } }),
      ]);

    const dump = {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      users: user ? [user] : [],
      workspaces,
      memberships,
      projects,
      tasks,
      dependencies,
      milestones,
      notes,
      scenarios,
      events,
    };

    const filename = `rp-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    rep.header('Content-Type', 'application/json; charset=utf-8');
    rep.header('Content-Disposition', `attachment; filename="${filename}"`);
    return rep.send(JSON.stringify(dump, null, 2));
  });

  return app;
}

async function main() {
  const prisma = new PrismaClient({ log: ['error'] });
  await seed(prisma);
  const app = await buildServer(prisma);
  const port = Number(process.env.PORT || 4000);
  // Default to loopback so single-user installs aren't reachable from the LAN.
  // Multi-user / production deploys override with HOST=0.0.0.0 (or specific iface).
  const host = process.env.HOST || '127.0.0.1';
  await app.listen({ port, host });

  // Background sweepers: expired Session and Invite rows otherwise pile up
  // (sessions are only purged lazily on a `lookupSession` hit; invites
  // never were). 6h is well below typical session lifetimes — at most one
  // stale row gets reused across that window. Running on the same prisma
  // client keeps the schema consistent for tests that mock fetch only.
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const sweepExpired = async (): Promise<void> => {
    const now = new Date();
    try {
      await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
    } catch (err) {
      app.log.warn({ err }, 'session sweeper failed');
    }
    try {
      await prisma.invite.deleteMany({
        where: { expiresAt: { lt: now }, acceptedAt: null },
      });
    } catch (err) {
      app.log.warn({ err }, 'invite sweeper failed');
    }
  };
  const sweeperHandle = setInterval(() => { void sweepExpired(); }, SIX_HOURS_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof sweeperHandle.unref === 'function') sweeperHandle.unref();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      clearInterval(sweeperHandle);
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

export { buildServer };
