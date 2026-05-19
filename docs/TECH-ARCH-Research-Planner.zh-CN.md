# Research Planner 技术方案与架构（MVP）

## 1. 目标与范围（基础功能）
- 单用户、多项目管理。
- 项目/任务/依赖/里程碑的基础模型；任务支持 O/M/P 时长与软/硬截止。
- 基于依赖（先完成→后开始，FS）与 O/M/P 的初始排程与自动重排。
- 两个基础视图：时间线（简化 Gantt）与看板（区分“思考/执行”）。
- 导出（Markdown/HTML），本地搜索与标签。

说明：分支（Branch）、条件依赖、协作与高级仿真等放入后续版本。

## 2. 技术选型
- 前端（Web）
  - TypeScript + React + Vite（快速开发与良好 DX）。
  - 路由与数据：TanStack Router/React Router，TanStack Query（服务端状态）。
  - 本地状态：Zustand（轻量），表单校验：Zod。
  - UI：Tailwind CSS + Headless UI（或 Radix UI）；日期：dayjs。
  - 可视化：
    - V1：自研简版 Gantt（SVG/Canvas + visx 可选）；看板使用可拖拽组件。
    - 后续：依赖图可用 React Flow/elkjs。
- 后端（API）
  - TypeScript + Fastify（高性能、良好类型支持）。
  - Schema 校验：Zod；ORM：Prisma；DB：PostgreSQL（开发可用 SQLite）。
  - 测试：Vitest + Supertest；日志：pino。
- 工程化
  - 包管理：pnpm（workspaces）。
  - Lint/格式：ESLint + Prettier + TypeScript 严格模式。
  - DevOps：Docker Compose（server + db），简单 CI（lint + build + test）。

## 3. 架构形态与分层
- 形态：单体后端 + 前端 SPA + 共享类型库（monorepo）。
- 分层：
  - Controller（路由/DTO）→ Service（领域逻辑）→ Repository（数据访问）。
  - Scheduler 作为领域服务（独立包，纯函数，便于测试/复用）。
- 状态与同步：
  - 客户端通过 TanStack Query 拉取/缓存；乐观更新用于轻交互。
  - 后端提供可选的 ETag/If-None-Match，MVP 可先不做实时推送。

## 4. 核心数据模型（MVP）
- Project
  - id, name, description, createdAt, updatedAt
- Milestone
  - id, projectId, title, criteria, startDate?, dueSoft?, dueHard?
- Task
  - id, projectId, title, type['thinking'|'reading'|'research'|'experiment'|'coding'|'analysis'|'writing'|'communication'|'admin']
  - status['todo'|'doing'|'blocked'|'review'|'done']
  - estimate: { o:number, m:number, p:number, confidence?:number }（单位：小时）
  - priority:number, labels:string[], assignee?:string
  - startPlanned?:Date, endPlanned?:Date（排程结果）
  - dueSoft?:Date, dueHard?:Date
  - milestoneId?:string, notes?:string
- Dependency
  - id, projectId, fromTaskId, toTaskId, type['FS']（MVP 仅支持 FS）
- ArtifactLink
  - id, taskId, kind['dataset'|'code'|'figure'|'doc'|'note'|'ref'], url, title?
- ChangeLog（可选）
  - id, scope['task'|'project'|'milestone'], refId, change, reason, createdAt

备注：后续可扩展 Dependency.type 为 SS/FF/SF，加入 Branch、Decision 等。

## 5. 排程引擎（MVP）
- 输入：项目内任务集合、FS 依赖、O/M/P 估计、软/硬截止（可选）。
- 计算策略：
  1) 使用 M 作为期望时长（后续可扩展为期望值 E=(O+4M+P)/6）。
  2) 构建依赖图并拓扑排序；检测环并给出提示。
  3) 自源（无前驱）任务按项目开始日期或“今天”计算 earliestStart。
  4) 对每个任务：durationM = max(M, 最小单位1h)。
  5) earliestStart = max(各前驱 endPlanned)，endPlanned = earliestStart + durationM。
  6) 若有 dueHard 且 endPlanned > dueHard，则标记为“违反硬截止”，在前端高亮。
  7) 更新受影响的下游任务（增量传播）。
- 输出：每个任务的 startPlanned/endPlanned、关键路径（基于最长路径）。
- 复杂度：O(V+E)。

## 6. API 草案（REST）
- Projects
  - GET `/api/projects`，POST `/api/projects`，GET/PUT/DELETE `/api/projects/:id`
- Tasks
  - GET `/api/projects/:id/tasks`，POST `/api/projects/:id/tasks`
  - GET/PUT/DELETE `/api/tasks/:taskId`
- Dependencies
  - GET `/api/projects/:id/deps`，POST `/api/projects/:id/deps`
  - DELETE `/api/deps/:depId`
- Milestones / Artifacts 同理提供 CRUD。
- Schedule
  - POST `/api/projects/:id/schedule`（触发重排并返回最新排程结果）。

请求/响应使用 Zod 校验与类型推导；错误以问题详情结构返回（code/message/fields）。

## 7. 前端信息架构与页面
- 路由
  - `/`：项目列表与概览。
  - `/projects/:id`：项目概览（目标、关键路径提示、近期活动）。
  - `/projects/:id/plan`：时间线/Gantt + 侧栏属性面板。
  - `/projects/:id/kanban`：看板视图（思考/执行泳道）。
  - `/projects/:id/report`：导出与周报。
- 交互要点
  - 快速捕捉任务（支持类型与 O/M/P）、拖拽调整优先级。
  - 编辑依赖（FS）：从属箭头绘制或下拉选择。
  - 手动修改任务时长/依赖后，触发增量重排与影响范围提示。

## 8. 项目文件系统结构（建议）
采用 pnpm monorepo，前后端与共享库分离，便于扩展与复用：

```
.
├─ docs/
│  ├─ PRD-Research-Planner.zh-CN.md
│  └─ TECH-ARCH-Research-Planner.zh-CN.md
├─ apps/
│  ├─ web/                   # React + Vite 前端
│  │  ├─ index.html
│  │  └─ src/
│  │     ├─ app/
│  │     │  ├─ routes/       # /, /projects/:id, /plan, /kanban, /report
│  │     │  ├─ providers/
│  │     │  └─ store/
│  │     ├─ components/      # 通用组件（Gantt、Kanban、Forms）
│  │     ├─ features/        # 项目、任务、依赖等模块化 UI
│  │     ├─ api/             # fetch 封装 + 类型
│  │     ├─ utils/
│  │     └─ styles/
│  └─ server/                # Fastify + Prisma 后端
│     └─ src/
│        ├─ app.ts           # Fastify 初始化
│        ├─ modules/
│        │  ├─ project/
│        │  │  ├─ project.controller.ts
│        │  │  ├─ project.service.ts
│        │  │  └─ project.schema.ts
│        │  ├─ task/
│        │  ├─ dependency/
│        │  ├─ milestone/
│        │  └─ artifact/
│        ├─ schedule/
│        │  └─ schedule.controller.ts
│        └─ infra/
│           ├─ db/           # Prisma 客户端
│           └─ logger/
├─ packages/
│  ├─ scheduler/             # 纯函数排程引擎（拓扑 + PERT）
│  │  └─ src/
│  │     ├─ types.ts
│  │     ├─ topo.ts
│  │     ├─ critical-path.ts
│  │     └─ schedule.ts
│  └─ shared/                # 通用类型、Zod schema、日期工具
│     └─ src/
│        ├─ types/
│        ├─ schemas/
│        └─ utils/
├─ scripts/
│  └─ dev.sh                 # 本地启动（可调用 docker-compose）
├─ docker-compose.yml        # server + db
├─ .env.example              # 环境变量示例
├─ package.json              # 工作区脚本（pnpm）
└─ pnpm-workspace.yaml
```

可先仅创建 docs 与 workspace 根文件，待实现阶段按需逐步落地目录。

## 9. 本地开发与运行（规划）
- 先决条件：Node 20+、pnpm、Docker（可选）。
- 推荐脚本（根 package.json）：
  - `pnpm dev:web` 启动 Vite。
  - `pnpm dev:server` 启动 Fastify（watch）。
  - `pnpm dev` 并行启动前后端。
  - `pnpm test` 运行前后端单测。
  - `pnpm db:push` 推送 Prisma schema 到本地 DB。
- 环境变量：
  - `DATABASE_URL=postgres://...`（或 sqlite:file:dev.db）。
  - `PORT=4000`、`NODE_ENV=development`。

## 10. 部署与演进
- 部署：
  - 后端：Docker 镜像（Fastify）+ 托管 PG（或 RDS/Cloud SQL）。
  - 前端：静态托管（Netlify/Vercel/S3+CDN）。
- 迁移：Prisma migrate；备份策略与种子数据脚本。
- 监控：基于 pino + 结构化日志；后续引入 OpenTelemetry。

## 11. 渐进增强与后续接入
- 分支/决策点、SS/FF/SF 依赖、缓冲与关键路径可视化。
- 情景模拟与蒙特卡洛、影响锥与容量曲线。
- 协作与权限、评论与共享链接、Zotero/OSF/Git 集成。

— 本文档用于指导 MVP 的架构搭建与目录落地，后续会在实现阶段细化到接口契约与组件约定，并与 PRD 同步演进。

