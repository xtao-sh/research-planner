// Canonical metadata order for any "task row" surface.
//
// Why this exists: the app has multiple row-rendering surfaces (Flow
// Board card, Task List row, /now task row, /search result, Tree
// Drawer row, Inbox related-task). Each was authored separately and by
// Round 15 they'd drifted into four different orderings of the same
// set of atoms — confusing for users scanning across views.
//
// The canonical order, from leading edge to trailing:
//
//   1. status pill          (always, leftmost)
//   2. title + project tag  (the row's identity)
//   3. size chip            (rendered uppercase, e.g. "M")
//   4. intensity bars       (5-bar widget, 1..5)
//   5. timeframe badge      (compact dot+letter variant — see #5 below)
//   6. dueHard / dueSoft    (only when present, e.g. ⏰ 06/12)
//   7. critical-path badge  (deadline mode only, when applicable)
//   8. deadline-risk badge  (deadline mode only, when applicable)
//   9. stale badge          (the doing-too-long / blocked-too-long chip)
//  10. focus pin            (always rightmost — interactive affordance)
//
// Notes:
// - Steps 6–8 are deadline-mode signals; in progress mode they're
//   silent. The other rows are mode-agnostic.
// - /now's task rows put the focus pin at the LEADING edge instead of
//   trailing — a deliberate exception, since /now is built around the
//   pin (it's the primary interaction on that page). Every other
//   surface uses trailing per the canonical order.
// - TimeframeBadge always renders in `variant="compact"` on row
//   surfaces. The `variant="full"` is reserved for the details drawer
//   and the briefing card where horizontal space is generous.
// - Size and intensity originally rendered the same magnitude on every
//   row (intensity is size-derived when task.intensity is null). Round
//   16 changed IntensityBars to render *only* when the user has
//   explicitly overridden intensity (task.intensity != null). So the
//   bars now signal "this task has a deliberate non-default load"
//   rather than duplicating the size chip. Edit surfaces (inline
//   editor, drawer) pass `alwaysRender` so the bars stay visible while
//   editing.
// - Row surfaces should render size + intensity via the shared
//   `<SizeChip>` and `<IntensityBars>` atoms in features/tasks/. The
//   manual `<span className="rd-size-chip">…` and 5x `<span className=
//   "rd-bar" />` markup is a drift hotspot.
// - This file is documentation-first; the exported constant is a
//   defensive runtime guard against drift but should be referenced by
//   any new row surface (e.g. via a comment) rather than blindly
//   iterated.

export const TASK_ROW_METADATA_ORDER = [
  'status',
  'title',
  'size',
  'intensity',
  'timeframe',
  'dueDate',
  'criticalPath',
  'deadlineRisk',
  'stale',
  'focusPin',
] as const;

export type TaskRowMetadataAtom = (typeof TASK_ROW_METADATA_ORDER)[number];
