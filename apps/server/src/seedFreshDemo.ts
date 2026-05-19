/**
 * One-shot demo reset script.
 *
 * Wipes all project-scoped data (projects, tasks, deps, milestones, notes,
 * events, scenarios) and seeds two showcase projects:
 *
 *   P1 — "气候适应模型研究" (research, deadline mode)
 *        Covers reading / thinking / analysis / coding / writing /
 *        communication / experiment / admin task types, all five statuses
 *        (todo, doing, blocked, review, done), parent/child subtasks,
 *        FS dependency edges, four milestones, and a couple of notes.
 *
 *   P2 — "公寓搬家计划" (personal, deadline mode)
 *        A different domain (life ops) showing the same feature surface
 *        applies outside research. Different priority distribution and
 *        a hard-deadline heavy timeline.
 *
 * Users / workspaces / calendars / sessions are PRESERVED. The demo
 * workspace `ws-demo` continues to own everything new.
 *
 * Run:  npx tsx apps/server/src/seedFreshDemo.ts
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const DEMO_WORKSPACE_ID = 'ws-demo';

// Helper — date offsets relative to "now" (today). Positive = future.
function daysFromNow(days: number, hours = 9): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hours, 0, 0, 0);
  return d;
}

interface SeedTask {
  id: string;
  title: string;
  type:
    | 'thinking' | 'reading' | 'research' | 'experiment'
    | 'coding' | 'analysis' | 'writing' | 'communication' | 'admin';
  status: 'todo' | 'doing' | 'blocked' | 'review' | 'done';
  size: 'xs' | 's' | 'm' | 'l' | 'xl';
  o: number; m: number; p: number;          // O/M/P estimate (hours)
  priority: number;                          // lower = higher priority
  parentTaskId?: string;
  milestoneId?: string;
  focused?: boolean;                         // pinned to Today
  startedAt?: Date;                          // when it moved to doing
  finishedAt?: Date;                         // when it moved to done
  blockedAt?: Date;                          // when it entered blocked
  dueSoft?: Date;
  dueHard?: Date;
  notes?: string;
  labels?: string[];
}

interface SeedMilestone {
  id: string;
  title: string;
  criteria?: string;
  dueSoft?: Date;
  dueHard?: Date;
}

interface SeedDep {
  fromTaskId: string;
  toTaskId: string;
}

interface SeedNote {
  body: string;
  tags?: string[];
}

interface SeedProject {
  id: string;
  name: string;
  description: string;
  type: 'research' | 'daily' | 'admin' | 'personal' | 'other';
  mode: 'progress' | 'deadline';
  startDate: Date;
  milestones: SeedMilestone[];
  tasks: SeedTask[];
  deps: SeedDep[];
  notes: SeedNote[];
}

// ============================================================
// PROJECT 1 — Research: Climate Adaptation Modeling Study
// ============================================================
const P1: SeedProject = {
  id: 'p-climate',
  name: '气候适应模型研究',
  description:
    '基于 ERA5 与本地站点数据训练区域气候适应模型，目标：14 周内完成数据准备、建模、对比与论文初稿。',
  type: 'research',
  mode: 'deadline',
  startDate: daysFromNow(-14),

  milestones: [
    {
      id: 'p1-m1',
      title: '文献综述完成',
      criteria: '20+ 篇核心文献整理 · 综述要点形成',
      dueSoft: daysFromNow(7),
    },
    {
      id: 'p1-m2',
      title: '数据收集与预处理完成',
      criteria: 'ERA5 + 站点数据接入 · 清洗脚本通过单元测试',
      dueSoft: daysFromNow(28),
    },
    {
      id: 'p1-m3',
      title: '基线与改进模型完成',
      criteria: 'Baseline 与改进模型对比表 · RMSE/CRPS 提升记录',
      dueSoft: daysFromNow(63),
    },
    {
      id: 'p1-m4',
      title: '论文初稿提交',
      criteria: 'Methods/Results/Intro/Discussion 全部成稿',
      dueHard: daysFromNow(90),
    },
  ],

  tasks: [
    // === DONE ===
    {
      id: 'p1-t01',
      title: '阅读 IPCC AR6 Working Group I 核心章节',
      type: 'reading', status: 'done', size: 's',
      o: 4, m: 6, p: 10, priority: 1,
      milestoneId: 'p1-m1',
      startedAt: daysFromNow(-14, 10),
      finishedAt: daysFromNow(-10, 17),
      notes: '重点关注 CH3 (大尺度气候动力)、CH11 (天气与气候极值) 与 CH12 (区域气候)。',
      labels: ['lit', 'IPCC'],
    },
    {
      id: 'p1-t02',
      title: '整理已有领域综述笔记',
      type: 'writing', status: 'done', size: 'xs',
      o: 1, m: 2, p: 4, priority: 2,
      milestoneId: 'p1-m1',
      startedAt: daysFromNow(-9, 14),
      finishedAt: daysFromNow(-9, 17),
    },

    // === DOING ===
    {
      id: 'p1-t03',
      title: '阅读最新 10 篇相关论文',
      type: 'reading', status: 'doing', size: 'm',
      o: 6, m: 10, p: 16, priority: 3,
      milestoneId: 'p1-m1',
      focused: true,
      startedAt: daysFromNow(-3, 9),
      dueSoft: daysFromNow(4),
      notes: '已读 4/10。重点：Sec.4 of Smith 2024 与 Liu 2025 的 CRPS-Net。',
      labels: ['lit'],
    },
    {
      id: 'p1-t04',
      title: '起草研究问题与假设',
      type: 'thinking', status: 'doing', size: 'm',
      o: 4, m: 8, p: 16, priority: 4,
      milestoneId: 'p1-m1',
      startedAt: daysFromNow(-2, 14),
      dueSoft: daysFromNow(5),
    },
    {
      id: 'p1-t04a',
      title: '列出 3 个候选 RQ',
      type: 'thinking', status: 'doing', size: 's',
      o: 1, m: 2, p: 4, priority: 1,
      parentTaskId: 'p1-t04',
      milestoneId: 'p1-m1',
      startedAt: daysFromNow(-1, 11),
    },
    {
      id: 'p1-t04b',
      title: '与导师讨论选定',
      type: 'communication', status: 'todo', size: 'xs',
      o: 0.5, m: 1, p: 2, priority: 2,
      parentTaskId: 'p1-t04',
      milestoneId: 'p1-m1',
      dueSoft: daysFromNow(7),
    },

    // === REVIEW ===
    {
      id: 'p1-t05',
      title: '撰写论文 Introduction',
      type: 'writing', status: 'review', size: 'm',
      o: 4, m: 8, p: 14, priority: 5,
      milestoneId: 'p1-m4',
      startedAt: daysFromNow(-5, 10),
      finishedAt: daysFromNow(-1, 18),
      dueSoft: daysFromNow(2),
      notes: '已发给导师，等待反馈。',
    },

    // === BLOCKED ===
    {
      id: 'p1-t06',
      title: '与气象局对接获取本地站点数据',
      type: 'communication', status: 'blocked', size: 'm',
      o: 4, m: 8, p: 24, priority: 6,
      milestoneId: 'p1-m2',
      blockedAt: daysFromNow(-2, 15),
      dueSoft: daysFromNow(14),
      notes: '等数据使用协议批复中。已联系 Dr. Wang，预计本周末有结果。',
    },

    // === TODO (queue) ===
    {
      id: 'p1-t07',
      title: '数据来源调研',
      type: 'research', status: 'todo', size: 'm',
      o: 3, m: 6, p: 12, priority: 7,
      milestoneId: 'p1-m2',
      dueSoft: daysFromNow(10),
    },
    {
      id: 'p1-t08',
      title: '申请 ERA5 数据访问',
      type: 'admin', status: 'todo', size: 's',
      o: 1, m: 2, p: 4, priority: 8,
      milestoneId: 'p1-m2',
      dueSoft: daysFromNow(7),
    },
    {
      id: 'p1-t09',
      title: '数据预处理脚本',
      type: 'coding', status: 'todo', size: 'l',
      o: 8, m: 16, p: 30, priority: 9,
      milestoneId: 'p1-m2',
      dueSoft: daysFromNow(24),
    },
    {
      id: 'p1-t10',
      title: '探索性数据分析（EDA）',
      type: 'analysis', status: 'todo', size: 'm',
      o: 6, m: 10, p: 18, priority: 10,
      milestoneId: 'p1-m2',
      dueSoft: daysFromNow(30),
    },
    {
      id: 'p1-t11',
      title: '训练基线模型 (XGBoost / Linear)',
      type: 'experiment', status: 'todo', size: 'l',
      o: 8, m: 16, p: 28, priority: 11,
      milestoneId: 'p1-m3',
      dueSoft: daysFromNow(45),
    },
    {
      id: 'p1-t12',
      title: '训练改进模型 (Transformer ensemble)',
      type: 'experiment', status: 'todo', size: 'xl',
      o: 16, m: 30, p: 60, priority: 12,
      milestoneId: 'p1-m3',
      dueSoft: daysFromNow(56),
    },
    {
      id: 'p1-t13',
      title: '模型对比与误差分析',
      type: 'analysis', status: 'todo', size: 'm',
      o: 6, m: 10, p: 20, priority: 13,
      milestoneId: 'p1-m3',
      dueSoft: daysFromNow(63),
    },
    {
      id: 'p1-t14',
      title: '撰写论文 Methods 章节',
      type: 'writing', status: 'todo', size: 'l',
      o: 8, m: 14, p: 24, priority: 14,
      milestoneId: 'p1-m4',
      dueSoft: daysFromNow(75),
    },
    {
      id: 'p1-t15',
      title: '撰写论文 Results 章节',
      type: 'writing', status: 'todo', size: 'l',
      o: 8, m: 14, p: 24, priority: 15,
      milestoneId: 'p1-m4',
      dueSoft: daysFromNow(82),
    },
    {
      id: 'p1-t16',
      title: '论文 Discussion 与 Conclusion',
      type: 'writing', status: 'todo', size: 'm',
      o: 4, m: 10, p: 16, priority: 16,
      milestoneId: 'p1-m4',
      dueSoft: daysFromNow(86),
      dueHard: daysFromNow(89),
    },
  ],

  // FS edges (predecessor → successor)
  deps: [
    { fromTaskId: 'p1-t03', toTaskId: 'p1-t04' },     // reading → questions
    { fromTaskId: 'p1-t04', toTaskId: 'p1-t05' },     // questions → intro
    { fromTaskId: 'p1-t07', toTaskId: 'p1-t09' },     // sources → preproc
    { fromTaskId: 'p1-t08', toTaskId: 'p1-t09' },     // ERA5 → preproc
    { fromTaskId: 'p1-t06', toTaskId: 'p1-t09' },     // station data → preproc
    { fromTaskId: 'p1-t09', toTaskId: 'p1-t10' },     // preproc → EDA
    { fromTaskId: 'p1-t10', toTaskId: 'p1-t11' },     // EDA → baseline
    { fromTaskId: 'p1-t11', toTaskId: 'p1-t12' },     // baseline → improved
    { fromTaskId: 'p1-t11', toTaskId: 'p1-t13' },     // baseline → compare
    { fromTaskId: 'p1-t12', toTaskId: 'p1-t13' },     // improved → compare
    { fromTaskId: 'p1-t13', toTaskId: 'p1-t14' },     // compare → methods
    { fromTaskId: 'p1-t13', toTaskId: 'p1-t15' },     // compare → results
    { fromTaskId: 'p1-t14', toTaskId: 'p1-t16' },     // methods → discussion
    { fromTaskId: 'p1-t15', toTaskId: 'p1-t16' },     // results → discussion
  ],

  notes: [
    {
      body:
        '#planning 整体节奏：前 2 周文献 + RQ → 3-5 周数据 → 6-9 周建模 → 10-13 周写作。\n' +
        '关键风险点：站点数据协议（已挂 #blocked）+ improved model 训练时长不确定。',
      tags: ['#planning', '#blocked'],
    },
    {
      body:
        '#idea 如果 ERA5 + 站点数据耦合不收敛，可以退化到只用 ERA5 + 邻近站点的 kNN 特征作为 baseline 改进。Sec.5 of Liu 2025 提供了类似思路。',
      tags: ['#idea', '#fallback'],
    },
  ],
};

// ============================================================
// PROJECT 2 — Personal: Apartment Move
// ============================================================
const P2: SeedProject = {
  id: 'p-move',
  name: '公寓搬家计划',
  description:
    '5 周内完成新公寓签约、打包、搬迁与安顿。硬截止：搬家日（已与房东确认）。',
  type: 'personal',
  mode: 'deadline',
  startDate: daysFromNow(-7),

  milestones: [
    {
      id: 'p2-m1',
      title: '签订新公寓租约',
      criteria: '租约签字 · 押金到账',
      dueSoft: daysFromNow(8),
    },
    {
      id: 'p2-m2',
      title: '打包完成',
      criteria: '所有箱子贴标 · 易碎品单独包装',
      dueSoft: daysFromNow(20),
    },
    {
      id: 'p2-m3',
      title: '搬家日',
      criteria: '所有物品到达新址 · 家具归位',
      dueHard: daysFromNow(22),
    },
    {
      id: 'p2-m4',
      title: '完全安顿',
      criteria: '拆包完成 · 必需家电购置 · 地址变更全部生效',
      dueSoft: daysFromNow(35),
    },
  ],

  tasks: [
    // === DONE ===
    {
      id: 'p2-t01',
      title: '列出预算与硬性需求清单',
      type: 'thinking', status: 'done', size: 's',
      o: 1, m: 2, p: 3, priority: 1,
      milestoneId: 'p2-m1',
      startedAt: daysFromNow(-7, 19),
      finishedAt: daysFromNow(-7, 21),
      notes: '预算 ≤ ¥6500/月 · 通勤 ≤ 30 分钟 · 阳台必须 · 允许猫。',
    },
    {
      id: 'p2-t02',
      title: '预约房产中介看房',
      type: 'admin', status: 'done', size: 'xs',
      o: 0.5, m: 1, p: 2, priority: 2,
      milestoneId: 'p2-m1',
      startedAt: daysFromNow(-6, 10),
      finishedAt: daysFromNow(-6, 11),
    },

    // === DOING ===
    {
      id: 'p2-t03',
      title: '比较 5 个候选公寓',
      type: 'research', status: 'doing', size: 'm',
      o: 3, m: 5, p: 10, priority: 3,
      milestoneId: 'p2-m1',
      focused: true,
      startedAt: daysFromNow(-3, 19),
      dueSoft: daysFromNow(3),
      notes: '已看 3 间。最看好朝阳门那套，但价格略超预算 5%。等周末再看 2 间作对比。',
    },

    // === BLOCKED ===
    {
      id: 'p2-t04',
      title: '与现房东沟通提前退租',
      type: 'communication', status: 'blocked', size: 's',
      o: 1, m: 2, p: 6, priority: 4,
      blockedAt: daysFromNow(-1, 16),
      dueSoft: daysFromNow(7),
      notes: '房东出差中，本周三回复。可能涉及最后一月房租按比例返还的协商。',
    },

    // === TODO (queue) ===
    {
      id: 'p2-t05',
      title: '协商租金与押金',
      type: 'communication', status: 'todo', size: 's',
      o: 1, m: 2, p: 4, priority: 5,
      milestoneId: 'p2-m1',
      dueSoft: daysFromNow(5),
    },
    {
      id: 'p2-t06',
      title: '签订租约',
      type: 'admin', status: 'todo', size: 's',
      o: 1, m: 2, p: 3, priority: 6,
      milestoneId: 'p2-m1',
      dueSoft: daysFromNow(8),
      dueHard: daysFromNow(10),
    },
    {
      id: 'p2-t07',
      title: '整理打包计划',
      type: 'thinking', status: 'todo', size: 'm',
      o: 2, m: 4, p: 8, priority: 7,
      milestoneId: 'p2-m2',
      dueSoft: daysFromNow(11),
    },
    {
      id: 'p2-t07a',
      title: '厨房 — 打包',
      type: 'admin', status: 'todo', size: 's',
      o: 2, m: 4, p: 6, priority: 1,
      parentTaskId: 'p2-t07',
      milestoneId: 'p2-m2',
      dueSoft: daysFromNow(17),
    },
    {
      id: 'p2-t07b',
      title: '卧室与衣物 — 打包',
      type: 'admin', status: 'todo', size: 's',
      o: 2, m: 4, p: 6, priority: 2,
      parentTaskId: 'p2-t07',
      milestoneId: 'p2-m2',
      dueSoft: daysFromNow(18),
    },
    {
      id: 'p2-t07c',
      title: '书房与办公 — 打包',
      type: 'admin', status: 'todo', size: 'm',
      o: 3, m: 5, p: 8, priority: 3,
      parentTaskId: 'p2-t07',
      milestoneId: 'p2-m2',
      dueSoft: daysFromNow(19),
      notes: '电脑与显示器单独打包。线缆贴标。',
    },
    {
      id: 'p2-t08',
      title: '预约搬家公司',
      type: 'admin', status: 'todo', size: 's',
      o: 1, m: 2, p: 4, priority: 8,
      milestoneId: 'p2-m3',
      dueSoft: daysFromNow(12),
    },
    {
      id: 'p2-t09',
      title: '转移水电气/网络账户',
      type: 'admin', status: 'todo', size: 's',
      o: 1, m: 2, p: 4, priority: 9,
      milestoneId: 'p2-m4',
      dueSoft: daysFromNow(20),
    },
    {
      id: 'p2-t10',
      title: '银行 / 订阅服务地址变更',
      type: 'admin', status: 'todo', size: 'm',
      o: 2, m: 3, p: 6, priority: 10,
      milestoneId: 'p2-m4',
      dueSoft: daysFromNow(28),
    },
    {
      id: 'p2-t11',
      title: '搬家当天 — 现场协调',
      type: 'admin', status: 'todo', size: 'l',
      o: 8, m: 10, p: 14, priority: 11,
      milestoneId: 'p2-m3',
      dueHard: daysFromNow(22),
    },
    {
      id: 'p2-t12',
      title: '拆包与房间归位',
      type: 'admin', status: 'todo', size: 'l',
      o: 8, m: 14, p: 24, priority: 12,
      milestoneId: 'p2-m4',
      dueSoft: daysFromNow(28),
    },
    {
      id: 'p2-t13',
      title: '购置新家具（书桌 / 餐椅）',
      type: 'research', status: 'todo', size: 'm',
      o: 3, m: 5, p: 10, priority: 13,
      milestoneId: 'p2-m4',
      dueSoft: daysFromNow(35),
    },
  ],

  deps: [
    { fromTaskId: 'p2-t03', toTaskId: 'p2-t05' },     // compare → negotiate
    { fromTaskId: 'p2-t05', toTaskId: 'p2-t06' },     // negotiate → sign
    { fromTaskId: 'p2-t06', toTaskId: 'p2-t04' },     // sign new → tell old landlord
    { fromTaskId: 'p2-t06', toTaskId: 'p2-t08' },     // sign → book movers
    { fromTaskId: 'p2-t07', toTaskId: 'p2-t11' },     // pack plan → move day
    { fromTaskId: 'p2-t08', toTaskId: 'p2-t11' },     // movers → move day
    { fromTaskId: 'p2-t11', toTaskId: 'p2-t12' },     // move → unpack
    { fromTaskId: 'p2-t11', toTaskId: 'p2-t09' },     // move → utilities
  ],

  notes: [
    {
      body:
        '#planning 关键路径：候选 → 协商 → 签约 → 打包 + 搬家 → 安顿。\n' +
        '硬截止：搬家日（房东已确认 #move-day），最迟 +2 天。',
      tags: ['#planning', '#move-day'],
    },
    {
      body:
        '#shopping 新公寓需要：1) 书桌（180×80 推荐 IKEA Bekant）；2) 餐椅 ×2；3) 落地灯。\n' +
        '不急的：新沙发可以先用旧的过渡 1-2 月。',
      tags: ['#shopping'],
    },
  ],
};

// ============================================================
// MAIN
// ============================================================
async function wipeProjectScopedData(prisma: PrismaClient): Promise<void> {
  // Order matters: children before parents to respect FKs.
  // (Prisma SQLite cascades most of these, but being explicit is safer.)
  await prisma.event.deleteMany({});
  await prisma.scenario.deleteMany({});
  await prisma.dependency.deleteMany({});
  await prisma.note.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.milestone.deleteMany({});
  await prisma.project.deleteMany({});
  // eslint-disable-next-line no-console
  console.log('[wipe] cleared projects, tasks, deps, milestones, notes, scenarios, events');
}

async function seedProject(
  prisma: PrismaClient,
  workspaceId: string,
  createdById: string,
  p: SeedProject
): Promise<void> {
  const now = new Date();

  // 1. project
  await prisma.project.create({
    data: {
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      mode: p.mode,
      createdAt: p.startDate,
      updatedAt: now,
      startDate: p.startDate,
      workspaceId,
    },
  });

  // 2. milestones (must exist before tasks reference them)
  for (const m of p.milestones) {
    await prisma.milestone.create({
      data: {
        id: m.id,
        projectId: p.id,
        title: m.title,
        criteria: m.criteria ?? null,
        dueSoft: m.dueSoft ?? null,
        dueHard: m.dueHard ?? null,
      },
    });
  }

  // 3. tasks — two-pass to satisfy parentTaskId FK.
  //    Pass 1: insert root tasks (no parent).
  //    Pass 2: insert child tasks.
  const roots = p.tasks.filter((t) => !t.parentTaskId);
  const children = p.tasks.filter((t) => t.parentTaskId);
  for (const t of [...roots, ...children]) {
    await prisma.task.create({
      data: {
        id: t.id,
        projectId: p.id,
        title: t.title,
        type: t.type,
        status: t.status,
        estimateO: t.o,
        estimateM: t.m,
        estimateP: t.p,
        size: t.size,
        priority: t.priority,
        labels: t.labels ? JSON.stringify(t.labels) : null,
        parentTaskId: t.parentTaskId ?? null,
        milestoneId: t.milestoneId ?? null,
        startedAt: t.startedAt ?? null,
        finishedAt: t.finishedAt ?? null,
        focusedAt: t.focused ? new Date() : null,
        blockedAt: t.blockedAt ?? null,
        dueSoft: t.dueSoft ?? null,
        dueHard: t.dueHard ?? null,
        notes: t.notes ?? null,
      },
    });
  }

  // 4. dependencies
  for (const d of p.deps) {
    await prisma.dependency.create({
      data: {
        id: randomUUID(),
        projectId: p.id,
        fromTaskId: d.fromTaskId,
        toTaskId: d.toTaskId,
        type: 'FS',
      },
    });
  }

  // 5. project-level notes
  for (const n of p.notes) {
    await prisma.note.create({
      data: {
        id: randomUUID(),
        workspaceId,
        projectId: p.id,
        createdById,
        body: n.body,
        tags: JSON.stringify(n.tags ?? []),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `[seed] ${p.id} "${p.name}" — ${p.tasks.length} tasks · ${p.deps.length} deps · ${p.milestones.length} milestones · ${p.notes.length} notes`
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    // sanity: demo user must exist
    const demoUser = await prisma.user.findUnique({
      where: { email: 'demo@local' },
    });
    if (!demoUser) {
      throw new Error(
        'demo@local user not found — run the regular seed first to create the demo user/workspace.'
      );
    }

    await wipeProjectScopedData(prisma);
    await seedProject(prisma, DEMO_WORKSPACE_ID, demoUser.id, P1);
    await seedProject(prisma, DEMO_WORKSPACE_ID, demoUser.id, P2);

    // eslint-disable-next-line no-console
    console.log('[done] seeded 2 demo projects');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
