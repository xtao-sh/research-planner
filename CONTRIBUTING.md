# Contributing to Research Planner

Thanks for thinking about contributing. This is an opinionated personal tool first and a public project second — but PRs are welcome, especially for the things below.

## Scope — what fits

The product is shaped by three beliefs (see the [PRD](docs/PRD-Research-Planner.v2.zh-CN.md) for the long version):

1. **Progress > deadlines.** Features that surface *current state* and *blockers* fit. Features that nudge users toward filling more fields generally don't.
2. **Capture > structure.** Anything that lowers the friction of adding a thought is welcome. Anything that adds required fields is suspect.
3. **Context on re-entry.** Re-opening a project should feel like resuming a conversation, not auditing a backlog.

**Good PR shapes**:
- Bug fixes (with a reproduction in the description)
- New views or panels that respect the three beliefs above
- Accessibility / keyboard-navigation improvements
- Translations (new locale JSON files in `apps/web/src/i18n/locales/`)
- Tauri / desktop packaging improvements (Linux, Windows)
- Performance work backed by a measurement

**Probably won't merge without discussion first**:
- New required fields on tasks, projects, or notes
- "Productivity score" / streak / gamification features
- AI-summarisation features baked into the core (these belong as opt-in plugins eventually, not as core dependencies)
- Anything that adds a paid third-party service to the default deployment path

If you're unsure, open an issue describing the idea before you build it.

## Getting set up

```bash
git clone https://github.com/xtao-sh/research-planner.git
cd research-planner
npm install
cd apps/server && npx prisma migrate deploy && cd ../..
npm run dev
```

Tests:

```bash
# Web (Vitest, jsdom)
npm run test --workspace=apps/web

# Server (Vitest, real Prisma + SQLite per-test fixtures)
npm run test --workspace=apps/server

# Typecheck everything
npx tsc -b apps/web apps/server
```

Both type-check passes and both test suites must be green before a PR can merge — CI enforces this automatically (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Code style

- TypeScript, strict mode. No `any` if you can avoid it; if you can't, comment why.
- React function components; hooks only.
- State at the **lowest level** that needs it. `AppDataContext` is for genuinely cross-cutting data only.
- Tailwind is **not** used. Styling lives in `apps/web/src/App.css` with CSS variables (`--rd-*` design tokens) and BEM-ish class names (`.rd-toast`, `.rd-flow-card`).
- New strings on the frontend must go through `t()` and have parallel entries in both `en.json` and `zh-CN.json`.
- Server routes validate input with zod schemas (see `apps/server/src/app.ts` for the prevailing pattern).
- Comments explain *why*, not *what*. Assume the reader knows TypeScript; explain the surrounding decision.

## Commit & PR style

Commits use a `<type>: <short summary>` prefix. Common types: `feat`, `fix`, `refactor`, `perf`, `docs`, `build`, `test`, `chore`.

```
feat(now): surface dormant-project observation in weekly review

Body paragraphs explain motivation, the approach, and any non-obvious trade-offs.
```

Squash-merge is the default. Keep PR descriptions short but specific: *what changes, why, and how it was tested*. Screenshots for any visual change.

## Reporting bugs

The most useful bug reports include:

1. **What you did** — exact steps, including which project mode (`progress` vs `deadline`) and which view (`/now`, `/projects/:id`, `/review`, etc.)
2. **What you expected**
3. **What happened** — including any console errors or toast text
4. **Environment** — browser + version, OS, and whether you're running in dev (`npm run dev`) or the bundled `.app`

Screenshots and short Loom-style screen recordings are gold for UI bugs.

## Security

If you find a security issue (XSS, auth bypass, data leak across workspaces), **please don't open a public issue**. Email the maintainer directly — see the GitHub profile for [@xtao-sh](https://github.com/xtao-sh).

## License

By submitting a contribution, you agree your work is licensed under the [MIT License](LICENSE) — the same as the rest of the project.

---

Thanks again. The aim isn't to ship every feature people ask for; it's to ship the *right shape* of features for the kind of work this tool exists to support. Hold us to that.
