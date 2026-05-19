// Core shared types for Research Planner (MVP)

export type ID = string;

export type TaskType =
  | 'thinking'
  | 'reading'
  | 'research'
  | 'experiment'
  | 'coding'
  | 'analysis'
  | 'writing'
  | 'communication'
  | 'admin';

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'review' | 'done';

export type TaskSize = 'xs' | 's' | 'm' | 'l' | 'xl';

export interface Estimate {
  o: number; // optimistic hours
  m: number; // most likely hours
  p: number; // pessimistic hours
  confidence?: number; // 0..1 optional
}

export type ProjectType = 'research' | 'daily' | 'admin' | 'personal' | 'other';

export type ProjectMode = 'progress' | 'deadline';

export interface Project {
  id: ID;
  name: string;
  description?: string;
  type: ProjectType;
  mode: ProjectMode;
  createdAt: string; // ISO date
  updatedAt: string; // ISO date
  startDate?: string; // ISO date; default to today if absent
}

export interface Milestone {
  id: ID;
  projectId: ID;
  title: string;
  criteria?: string;
  startDate?: string; // ISO date
  dueSoft?: string; // ISO date
  dueHard?: string; // ISO date
}

export interface Task {
  id: ID;
  projectId: ID;
  title: string;
  type: TaskType;
  status: TaskStatus;
  estimate: Estimate; // O/M/P hours
  priority: number; // lower = higher priority
  size: TaskSize;
  /** 1..5 cognitive load. Null = use size-derived fallback in UI. */
  intensity?: number;
  labels?: string[];
  assignee?: string;
  startPlanned?: string; // ISO date-time
  endPlanned?: string; // ISO date-time
  startedAt?: string; // ISO date-time — when task first moved to `doing`
  finishedAt?: string; // ISO date-time — when task moved to `done`
  focusedAt?: string; // ISO date-time — when user pinned to Top of Mind
  blockedAt?: string; // ISO date-time — when task entered 'blocked' status
  dueSoft?: string; // ISO date-time
  dueHard?: string; // ISO date-time
  milestoneId?: ID;
  /** Parent task — when present, this task is rendered indented under the
   *  parent in the project task list. Single-parent tree, max depth 3.
   *  onDelete: SetNull on the server (children become top-level). */
  parentTaskId?: ID;
  /** Server-derived flag — whether this task has any children. Used by the
   *  client to render a chevron / hide leaves from /now. NOT a column. */
  hasChildren?: boolean;
  notes?: string;
  updatedAt?: string; // ISO date-time — last server-side mutation
}

export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Dependency {
  id: ID;
  projectId: ID;
  fromTaskId: ID; // predecessor
  toTaskId: ID; // successor
  type: DepType;
  lag: number; // hours; may be negative (lead)
}

export interface ArtifactLink {
  id: ID;
  taskId: ID;
  kind: 'dataset' | 'code' | 'figure' | 'doc' | 'note' | 'ref';
  url: string;
  title?: string;
}

export interface ScheduleResultItem {
  taskId: ID;
  startPlanned: string;
  endPlanned: string;
  violatesHardDue?: boolean;
  violatesSoftDue?: boolean;
}

export interface ScheduleResult {
  projectId: ID;
  items: ScheduleResultItem[];
  criticalPath: ID[]; // task IDs
}

export interface Scenario {
  id: ID;
  projectId: ID;
  name: string;
  durationMode: 'expected' | 'optimistic' | 'pessimistic';
  createdAt: string;
  snapshot: ScheduleResult;
}

// Working calendar (Phase 3b): per-workspace weekly hours + holidays.
// UTC-only for this phase.
export interface Holiday {
  id: ID;
  calendarId: ID;
  date: string; // "YYYY-MM-DD"
  name: string;
}

export interface WorkingCalendar {
  id: ID;
  workspaceId: ID;
  // 7 entries indexed by day-of-week (0=Sun..6=Sat). Each entry is either
  // { startHour, endHour } for an open day, or null for a closed day.
  weeklyHours: Array<{ startHour: number; endHour: number } | null>;
  createdAt: string;
  updatedAt: string;
  holidays: Holiday[];
}

// Workspace roles (fine-grained, Phase 4)
export type WorkspaceRole =
  | 'owner'
  | 'admin'
  | 'editor'
  | 'commenter'
  | 'viewer';

// Event sourcing / audit log
export type EventType =
  | 'project.created' | 'project.updated' | 'project.deleted'
  | 'task.created' | 'task.updated' | 'task.deleted'
  | 'dependency.created' | 'dependency.deleted'
  | 'milestone.created' | 'milestone.updated' | 'milestone.deleted'
  | 'scenario.created' | 'scenario.deleted'
  | 'workspace.created' | 'workspace.member.invited' | 'workspace.member.removed'
  | 'workspace.member.role_changed' | 'workspace.owner.transferred'
  | 'workspace.calendar.updated' | 'workspace.holiday.added' | 'workspace.holiday.removed'
  | 'workspace.invite.created' | 'workspace.invite.revoked' | 'workspace.invite.accepted'
  | 'note.created' | 'note.updated';

// Persistent quick-capture / inbox notes (Phase C).
// projectId === null means the note is in the author's inbox.
export interface Note {
  id: ID;
  workspaceId: ID;
  projectId: ID | null;
  createdById: ID;
  createdByEmail: string | null;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// Invite (email-based invitations) — Phase 4b
export interface InviteRecord {
  id: ID;
  workspaceId: ID;
  email: string;
  role: 'admin' | 'editor' | 'commenter' | 'viewer';
  invitedById: ID | null;
  invitedByEmail: string | null;   // denormalized for display
  expiresAt: string;               // ISO
  createdAt: string;               // ISO
}

export interface InvitePreview {
  workspaceName: string;
  role: 'admin' | 'editor' | 'commenter' | 'viewer';
  email: string;
  expiresAt: string;
}

export interface EventRecord {
  id: ID;
  workspaceId: ID;
  projectId: ID | null;
  userId: ID | null;
  userEmail: string | null;       // denormalized for display
  type: EventType;
  payload: unknown;               // parsed from the DB's JSON string
  createdAt: string;              // ISO
}

// ---------------- Real-time WebSocket wire types ----------------

/**
 * Server-to-client envelope describing a DB-level event in a workspace. The
 * client reacts by refetching — the envelope intentionally carries no payload.
 * NOTE: `kind: 'event'` was added when presence awareness landed so the
 * client can discriminate event vs presence frames; older clients that
 * ignore unknown fields remain compatible.
 */
export interface BroadcastEnvelope {
  v: 1;
  kind: 'event';
  workspaceId: ID;
  projectId: ID | null;
  eventType: EventType;
  eventId: ID;
  at: string;
}

/**
 * A single online member in a workspace, as seen by other connected clients.
 * Presence is per-socket: a user with two tabs open (different active
 * projects) appears twice. This matches Google-Docs-style behavior and
 * sidesteps the fan-in needed to dedupe multi-tab presence for the MVP.
 */
export interface PresenceMember {
  userId: ID;
  email: string;
  name: string | null;
  projectId: ID | null;   // null = on workspace home / no project selected
  sinceIso: string;       // when this socket connected
}

export interface PresenceFrame {
  v: 1;
  kind: 'presence';
  members: PresenceMember[];
}

/** Any frame the server may push over /ws/workspace/:id. */
export type ServerFrame = BroadcastEnvelope | PresenceFrame;

/** Any frame the client may send to the server. */
export type ClientFrame =
  | { v: 1; type: 'hello'; projectId: ID | null }
  | { v: 1; type: 'project'; projectId: ID | null }
  | { v: 1; type: 'ping' };

/**
 * Server-side cross-entity search results. Returned by GET /api/search?q=…
 * Each list capped at 50 rows server-side; lists are scoped to workspaces
 * the caller is a member of.
 */
export interface SearchResults {
  query: string;
  tasks: Array<Pick<Task, 'id' | 'projectId' | 'title' | 'status' | 'size' | 'priority' | 'dueSoft' | 'dueHard'>>;
  notes: Array<Pick<Note, 'id' | 'projectId' | 'body' | 'tags' | 'createdAt'>>;
  projects: Array<Pick<Project, 'id' | 'name' | 'type' | 'description'>>;
}

