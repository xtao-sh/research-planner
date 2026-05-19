import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Dependency, Milestone, Project, Scenario, Task } from '@rp/shared';

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

  // Tasks
  for (const [, list] of parsed.tasks || []) {
    for (const t of list) {
      const labelsJson = t.labels ? JSON.stringify(t.labels) : null;
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
  const projectId = 'p1';
  const now = new Date();

  await prisma.project.upsert({
    where: { id: projectId },
    update: { workspaceId: demoWorkspaceId, mode: 'deadline' },
    create: {
      id: projectId,
      name: 'Demo Project',
      description: 'Seeded demo',
      type: 'research',
      mode: 'deadline',
      createdAt: now,
      updatedAt: now,
      startDate: now,
      workspaceId: demoWorkspaceId,
    },
  });

  const tasks = [
    { id: 't1', title: '阅读核心文献', type: 'reading',  o: 2, m: 4, p: 8,  size: 's', priority: 1 },
    { id: 't2', title: '数据预处理',   type: 'analysis', o: 2, m: 6, p: 10, size: 'm', priority: 2 },
    { id: 't3', title: '建模与验证',   type: 'analysis', o: 4, m: 8, p: 16, size: 'l', priority: 3 },
  ];
  for (const t of tasks) {
    await prisma.task.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        projectId,
        title: t.title,
        type: t.type,
        status: 'todo',
        estimateO: t.o,
        estimateM: t.m,
        estimateP: t.p,
        size: t.size,
        priority: t.priority,
      },
    });
  }

  const deps = [
    { id: 'd1', fromTaskId: 't1', toTaskId: 't2' },
    { id: 'd2', fromTaskId: 't2', toTaskId: 't3' },
  ];
  for (const d of deps) {
    await prisma.dependency.upsert({
      where: { id: d.id },
      update: {},
      create: {
        id: d.id,
        projectId,
        fromTaskId: d.fromTaskId,
        toTaskId: d.toTaskId,
        type: 'FS',
      },
    });
  }

  await prisma.milestone.upsert({
    where: { id: 'm1' },
    update: {},
    create: {
      id: 'm1',
      projectId,
      title: '第一阶段验收',
      dueSoft: new Date(Date.now() + 14 * 24 * 3600 * 1000),
    },
  });
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
