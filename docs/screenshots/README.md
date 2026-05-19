# Screenshot capture brief

The main [README](../../README.md) references four screenshots. This page describes what each one should communicate — both as a reminder when re-shooting them after UI changes, and so the project's positioning stays consistent across visual marketing.

Save each as a PNG at this path, ideally 1600–2000 px wide, 1×–2× DPI, light theme (the default).

---

## `now.png` — Top-of-Mind (`/now`)

**Communicates**: *"This isn't a backlog. It's a reading of the moment."*

The shot should make the **capacity rail** and **stuck-task surfacing** visible. Ideal scene:

- One or two tasks in the **Pinned for today** strip
- Three to five tasks in **Doing now** with at least one carrying a `staleDoing` badge ("doing 9 days")
- One task in **Blocked** with a reason note
- The **briefing card** for at least one project (the "we left off mid-flight" card)
- Capacity rail showing some committed intensity points against the daily budget

The greeting line at the top ("Good afternoon, Wednesday Oct 15.") sets the human tone.

---

## `flow-board.png` — Flow Board (`/projects/:id` in progress mode)

**Communicates**: *"Progress mode is the default. It looks like a kanban — but it knows about intensity and stale tasks."*

- Five status columns visible (Todo / Doing / Blocked / Review / Done)
- At least one card with the **intensity bars** rendered (the 5-bar dot indicator)
- At least one card with the **stale badge**
- A card mid-drag, showing the **DragOverlay** floating between columns
- The project header showing the **progress / deadline mode toggle**

---

## `uncertainty-lane.png` — Uncertainty Lane (`/projects/:id` in deadline mode → Uncertainty)

**Communicates**: *"Estimates are ranges, not points. The critical path runs through cones."*

- Six to ten tasks in a project with O/M/P (optimistic / most-likely / pessimistic) estimates set
- The **critical path** highlighted in accent colour
- The "now" vertical rule visible against the cones
- The legend at the top showing the three timestamp confidences

A small project where every task has all three PERT values is best — otherwise the cones look uneven.

---

## `review.png` — Weekly Retrospective (`/review`)

**Communicates**: *"A reflection, not a report card."*

- The **Momentum** card with three numbers (tasks moved / completed / still blocked) — *not* a completion-percentage gauge
- The **Capacity used** card (intensity-points-per-day grid for the week)
- The **What this week showed** observations list (e.g. "3 tasks still blocked. Consider unblocking or splitting." / "Capacity is signal, not score.")
- One dormant-project observation if available

---

## Capture process

1. Seed a small but realistic project with PERT estimates, a mix of statuses, and a few notes via Quick Capture.
2. Run the app at a 1440×900-ish window. Don't blow it up to a 4K canvas — the screenshots should look like the experience.
3. Use system "Capture window" (⌘⇧4 then space on macOS) so you get the rounded corners + drop shadow.
4. Save as PNG, drop in this directory with the exact filename the README expects.

When the UI shifts meaningfully, retake. Stale screenshots are worse than no screenshots.
