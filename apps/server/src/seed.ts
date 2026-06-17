import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Dependency, Milestone, Project, Scenario, Task } from '@rp/shared';
import { mergeTags } from './notes';

const DEMO_EMAIL = 'demo@local';
const DEMO_PASSWORD = 'demo123';
const DEMO_WORKSPACE_ID = 'ws-demo';
const DEMO_WORKSPACE_NAME = 'Demo Workspace';

/**
 * Ensure the demo user exists and has a personal workspace.
 * Returns { userId, workspaceId }. Fully idempotent.
 */
async function ensureDemoUserAndWorkspace(
  prisma: PrismaClient
): Promise<{ userId: string; workspaceId: string }> {
  const existingUser = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    const created = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: DEMO_EMAIL,
        passwordHash,
        name: 'Demo',
      },
    });
    userId = created.id;
  }

  // Upsert demo workspace (deterministic id for idempotency).
  await prisma.workspace.upsert({
    where: { id: DEMO_WORKSPACE_ID },
    update: { name: DEMO_WORKSPACE_NAME },
    create: { id: DEMO_WORKSPACE_ID, name: DEMO_WORKSPACE_NAME },
  });

  // Default working calendar (Phase 3b): Mon-Fri 09:00-18:00 UTC.
  const existingCal = await prisma.workingCalendar.findUnique({
    where: { workspaceId: DEMO_WORKSPACE_ID },
  });
  if (!existingCal) {
    await prisma.workingCalendar.create({
      data: {
        id: randomUUID(),
        workspaceId: DEMO_WORKSPACE_ID,
        weeklyHours: JSON.stringify([
          null,
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          null,
        ]),
      },
    });
  }

  // Ensure demo user is owner of the demo workspace (idempotent).
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId } },
  });
  if (!membership) {
    await prisma.workspaceMember.create({
      data: {
        id: randomUUID(),
        workspaceId: DEMO_WORKSPACE_ID,
        userId,
        role: 'owner',
      },
    });
  } else if (membership.role !== 'owner') {
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId } },
      data: { role: 'owner' },
    });
  }

  // Ensure defaultWorkspaceId is set.
  const userRow = await prisma.user.findUnique({ where: { id: userId } });
  if (!userRow?.defaultWorkspaceId) {
    await prisma.user.update({
      where: { id: userId },
      data: { defaultWorkspaceId: DEMO_WORKSPACE_ID },
    });
  }

  return { userId, workspaceId: DEMO_WORKSPACE_ID };
}

/**
 * For every user without a personal workspace, create one and make them admin.
 * Also fixes any project row that is orphaned (shouldn't happen given the
 * migration but belt-and-suspenders).
 */
async function ensurePersonalWorkspaces(prisma: PrismaClient): Promise<void> {
  const users = await prisma.user.findMany({
    where: { defaultWorkspaceId: null },
  });
  for (const u of users) {
    const wsId = randomUUID();
    await prisma.workspace.create({
      data: { id: wsId, name: `${u.email}'s workspace` },
    });
    await prisma.workspaceMember.create({
      data: {
        id: randomUUID(),
        workspaceId: wsId,
        userId: u.id,
        role: 'owner',
      },
    });
    await prisma.workingCalendar.create({
      data: {
        id: randomUUID(),
        workspaceId: wsId,
        weeklyHours: JSON.stringify([
          null,
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          null,
        ]),
      },
    });
    await prisma.user.update({
      where: { id: u.id },
      data: { defaultWorkspaceId: wsId },
    });
  }
}

// ---------------- Legacy store.json shape ----------------

interface StoreShape {
  projects: Array<[string, Project]>;
  tasks: Array<[string, Task[]]>;
  deps: Array<[string, Dependency[]]>;
  milestones: Array<[string, Milestone[]]>;
  scenarios: Array<[string, Scenario[]]>;
}

function parseMaybeDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function migrateFromJson(prisma: PrismaClient, parsed: StoreShape, demoWorkspaceId: string) {
  // Projects
  for (const [, p] of parsed.projects || []) {
    await prisma.project.upsert({
      where: { id: p.id },
      update: {
        name: p.name,
        description: p.description ?? null,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
        startDate: parseMaybeDate(p.startDate),
        workspaceId: demoWorkspaceId,
      },
      create: {
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
        startDate: parseMaybeDate(p.startDate),
        workspaceId: demoWorkspaceId,
      },
    });
  }

  // Milestones first (Task may reference milestone)
  for (const [, list] of parsed.milestones || []) {
    for (const m of list) {
      await prisma.milestone.upsert({
        where: { id: m.id },
        update: {
          projectId: m.projectId,
          title: m.title,
          criteria: m.criteria ?? null,
          startDate: parseMaybeDate(m.startDate),
          dueSoft: parseMaybeDate(m.dueSoft),
          dueHard: parseMaybeDate(m.dueHard),
        },
        create: {
          id: m.id,
          projectId: m.projectId,
          title: m.title,
          criteria: m.criteria ?? null,
          startDate: parseMaybeDate(m.startDate),
          dueSoft: parseMaybeDate(m.dueSoft),
          dueHard: parseMaybeDate(m.dueHard),
        },
      });
    }
  }

  // Tasks. Seed assigns deterministic timeframe buckets per-task so the
  // demo workspace shows the bucket feature in action — without this
  // the UI works but renders no bucket badges anywhere, which obscures
  // what /now's "By timeframe" section is even for. Cycle through the
  // dated buckets (week → month → quarter → year) by task index;
  // someday is reserved for explicit user opt-in. Anchor is "now minus
  // a sprinkling" so some tasks read as fresh and a few as past-window.
  const TF_CYCLE = ['week', 'month', 'quarter', 'year'] as const;
  let tfIdx = 0;
  for (const [, list] of parsed.tasks || []) {
    for (const t of list) {
      const labelsJson = t.labels ? JSON.stringify(t.labels) : null;
      // Skip bucketing on done tasks (history) and on every 4th task
      // (some real tasks have no commitment yet — keeps the UI honest).
      const bucket =
        t.status === 'done' || tfIdx % 4 === 3
          ? null
          : TF_CYCLE[tfIdx % TF_CYCLE.length];
      // Anchor jitter: most tasks anchor in the last week so they're
      // mid-window; a few anchor 2-3 weeks back so the demo shows the
      // is-past styling on week-bucket items.
      const anchorOffsetDays =
        bucket && tfIdx % 5 === 0 ? -16 : tfIdx % 7;
      const anchor =
        bucket
          ? new Date(Date.now() - anchorOffsetDays * 86_400_000)
          : null;
      tfIdx++;
      const tfFields = bucket
        ? { timeframeBucket: bucket, timeframeAnchor: anchor }
        : { timeframeBucket: null, timeframeAnchor: null };
      await prisma.task.upsert({
        where: { id: t.id },
        update: {
          projectId: t.projectId,
          title: t.title,
          type: t.type,
          status: t.status,
          estimateO: t.estimate.o,
          estimateM: t.estimate.m,
          estimateP: t.estimate.p,
          confidence: t.estimate.confidence ?? null,
          priority: t.priority,
          labels: labelsJson,
          assignee: t.assignee ?? null,
          startPlanned: parseMaybeDate(t.startPlanned),
          endPlanned: parseMaybeDate(t.endPlanned),
          dueSoft: parseMaybeDate(t.dueSoft),
          dueHard: parseMaybeDate(t.dueHard),
          milestoneId: t.milestoneId ?? null,
          notes: t.notes ?? null,
          ...tfFields,
        },
        create: {
          id: t.id,
          projectId: t.projectId,
          title: t.title,
          type: t.type,
          status: t.status,
          estimateO: t.estimate.o,
          estimateM: t.estimate.m,
          estimateP: t.estimate.p,
          confidence: t.estimate.confidence ?? null,
          priority: t.priority,
          labels: labelsJson,
          assignee: t.assignee ?? null,
          startPlanned: parseMaybeDate(t.startPlanned),
          endPlanned: parseMaybeDate(t.endPlanned),
          dueSoft: parseMaybeDate(t.dueSoft),
          dueHard: parseMaybeDate(t.dueHard),
          milestoneId: t.milestoneId ?? null,
          notes: t.notes ?? null,
          ...tfFields,
        },
      });
    }
  }

  // Dependencies
  for (const [, list] of parsed.deps || []) {
    for (const d of list) {
      await prisma.dependency.upsert({
        where: { id: d.id },
        update: {
          projectId: d.projectId,
          fromTaskId: d.fromTaskId,
          toTaskId: d.toTaskId,
          type: d.type,
        },
        create: {
          id: d.id,
          projectId: d.projectId,
          fromTaskId: d.fromTaskId,
          toTaskId: d.toTaskId,
          type: d.type,
        },
      });
    }
  }

  // Scenarios
  for (const [, list] of parsed.scenarios || []) {
    for (const s of list) {
      await prisma.scenario.upsert({
        where: { id: s.id },
        update: {
          projectId: s.projectId,
          name: s.name,
          durationMode: s.durationMode,
          createdAt: new Date(s.createdAt),
          snapshot: JSON.stringify(s.snapshot),
        },
        create: {
          id: s.id,
          projectId: s.projectId,
          name: s.name,
          durationMode: s.durationMode,
          createdAt: new Date(s.createdAt),
          snapshot: JSON.stringify(s.snapshot),
        },
      });
    }
  }
}

async function seedDemo(prisma: PrismaClient, demoWorkspaceId: string) {
  // Runs only on an empty DB (seed() guards on project.count() === 0). Every
  // date is a deterministic offset from "now" — no randomness — so the /now
  // re-entry briefing, stale detection and the scheduler tests stay stable.
  const now = Date.now();
  const day = 86_400_000;
  const ago = (days: number): Date => new Date(now - days * day);
  const agoOrNull = (days: number | null | undefined): Date | null =>
    days == null ? null : ago(days);

  const demoUser = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  const createdById = demoUser?.id ?? null;

  // Three progress-mode projects spanning research / daily / admin. Staggered
  // updatedAt values give the "what changed since you were away" briefing
  // something real to surface.
  const projects: Array<[string, string, string, string, number, number]> = [
    ['p1', '多任务切换研究', 'research', '探究任务切换对认知负荷的影响。按进展推进，不押 deadline。', 40, 8],
    ['p2', '每周文献跟读', 'daily', '维持每周的文献输入与组会节奏。', 25, 2],
    ['p3', '行政与报销', 'admin', '设备申购、报销、伦理审查等杂事。', 30, 4],
  ];
  for (const [id, name, type, description, startedDaysAgo, updatedDaysAgo] of projects) {
    await prisma.project.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name,
        description,
        type,
        mode: 'progress',
        startDate: ago(startedDaysAgo),
        createdAt: ago(startedDaysAgo),
        updatedAt: ago(updatedDaysAgo),
        workspaceId: demoWorkspaceId,
      },
    });
  }

  await prisma.milestone.upsert({
    where: { id: 'm1' },
    update: {},
    create: {
      id: 'm1',
      projectId: 'p1',
      title: '预实验与范式定稿',
      criteria: '范式跑通、数据可用',
      dueSoft: ago(-21),
    },
  });

  // Tasks. p1 deliberately stays a clean t1 -> t2 -> t3 finish-to-start chain
  // (t3 keeps O/M/P = 4/8/16) so the scheduler/PERT contract is stable; the
  // *status mix* is what showcases progress mode. t2 is a stale (8d) pinned
  // "doing" task and t6 a stale (4d) "blocked" task, so /now lights up.
  interface TaskRow {
    id: string; pid: string; title: string; type: string; status: string;
    o: number; m: number; p: number; size: string; priority: number;
    started?: number; finished?: number; blocked?: number; focused?: number;
    bucket?: string | null; anchor?: number | null; labels?: string | null;
    notes?: string | null; updated: number;
  }
  const tasks: TaskRow[] = [
    { id: 't1', pid: 'p1', title: '梳理经典切换范式', type: 'reading', status: 'done',
      o: 2, m: 4, p: 8, size: 'm', priority: 1, started: 34, finished: 28, labels: '["lit"]', updated: 28 },
    { id: 't2', pid: 'p1', title: '搭建切换范式程序', type: 'coding', status: 'doing',
      o: 3, m: 6, p: 12, size: 'l', priority: 2, started: 8, focused: 8,
      bucket: 'week', anchor: 8, labels: '["exp"]', notes: '卡在随机化逻辑，先跑通最小可用版本。', updated: 8 },
    { id: 't3', pid: 'p1', title: '分析数据并撰写初稿', type: 'writing', status: 'review',
      o: 4, m: 8, p: 16, size: 'm', priority: 3, started: 12, notes: '已发导师，等反馈。', updated: 11 },
    { id: 't4', pid: 'p2', title: '精读两篇核心论文', type: 'reading', status: 'todo',
      o: 2, m: 4, p: 6, size: 's', priority: 1, focused: 2, bucket: 'week', anchor: 2, labels: '["lit"]', updated: 2 },
    { id: 't5', pid: 'p2', title: '整理上周组会笔记', type: 'writing', status: 'done',
      o: 1, m: 2, p: 3, size: 's', priority: 2, started: 5, finished: 3, updated: 3 },
    { id: 't6', pid: 'p3', title: '提交伦理审查材料', type: 'admin', status: 'blocked',
      o: 1, m: 2, p: 6, size: 's', priority: 1, blocked: 4, notes: '等伦理委员会例会。', updated: 4 },
  ];
  for (const t of tasks) {
    await prisma.task.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        projectId: t.pid,
        title: t.title,
        type: t.type,
        status: t.status,
        estimateO: t.o,
        estimateM: t.m,
        estimateP: t.p,
        size: t.size,
        priority: t.priority,
        milestoneId: t.pid === 'p1' ? 'm1' : null,
        startedAt: agoOrNull(t.started),
        finishedAt: agoOrNull(t.finished),
        blockedAt: agoOrNull(t.blocked),
        focusedAt: agoOrNull(t.focused),
        timeframeBucket: t.bucket ?? null,
        timeframeAnchor: agoOrNull(t.anchor),
        labels: t.labels ?? null,
        notes: t.notes ?? null,
        updatedAt: ago(t.updated),
      },
    });
  }

  // Finish-to-start chain inside p1: t1 -> t2 -> t3. Keeps the criticalPath
  // [t1, t2, t3] contract the scheduler tests assert.
  const deps: Array<[string, string, string]> = [
    ['d1', 't1', 't2'],
    ['d2', 't2', 't3'],
  ];
  for (const [id, fromTaskId, toTaskId] of deps) {
    await prisma.dependency.upsert({
      where: { id },
      update: {},
      create: { id, projectId: 'p1', fromTaskId, toTaskId, type: 'FS' },
    });
  }

  // Notes: two project-scoped, two unfiled inbox captures (projectId null).
  // #hashtags in the body are extracted into tags via mergeTags, so search,
  // the inbox and the project notes tabs all have real content to show.
  if (createdById) {
    const notes: Array<[string, string | null, string, number]> = [
      ['n1', 'p1', '#planning 不押 deadline：先把范式调通，再开始正式采集。伦理批复 #blocked 是当前最大的不确定。', 8],
      ['n2', 'p2', '#reading Liu 2025 的 dual-task 操纵做得很干净，组会重点讲这篇。', 2],
      ['n3', null, '#inbox 招募文案要不要单独写一版？多半归到「多任务切换研究」。 #recruit', 3],
      ['n4', null, '#inbox 存一篇 mind-wandering 综述，之后再读。 #lit', 1],
    ];
    for (const [id, projectId, body, createdDaysAgo] of notes) {
      await prisma.note.upsert({
        where: { id },
        update: {},
        create: {
          id,
          workspaceId: demoWorkspaceId,
          projectId,
          createdById,
          body,
          tags: JSON.stringify(mergeTags(undefined, body)),
          createdAt: ago(createdDaysAgo),
          updatedAt: ago(createdDaysAgo),
        },
      });
    }
  }
}

export async function seed(prisma: PrismaClient): Promise<void> {
  // Ensure the demo user + demo workspace + membership (idempotent).
  const { workspaceId: demoWorkspaceId } = await ensureDemoUserAndWorkspace(prisma);
  // eslint-disable-next-line no-console
  console.log('Seeded demo user demo@local / demo123 (only if you were starting fresh)');

  // Any other pre-existing users (e.g. from legacy stores) that lack a
  // personal workspace get one now.
  await ensurePersonalWorkspaces(prisma);

  // If any project already exists, skip the import/demo-seed step — it's idempotent.
  const existingCount = await prisma.project.count();
  if (existingCount > 0) {
    return;
  }

  const dataFile = resolve(
    process.env.DATA_FILE || resolve(__dirname, '../.data/store.json')
  );
  if (existsSync(dataFile)) {
    try {
      const raw = readFileSync(dataFile, 'utf-8');
      const parsed = JSON.parse(raw) as StoreShape;
      await migrateFromJson(prisma, parsed, demoWorkspaceId);
      // eslint-disable-next-line no-console
      console.log(`[seed] Migrated data from ${dataFile}`);
      return;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[seed] Failed to migrate from store.json, falling back to demo seed:', err);
    }
  }

  await seedDemo(prisma, demoWorkspaceId);
  // eslint-disable-next-line no-console
  console.log('[seed] Seeded demo project p1');
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
