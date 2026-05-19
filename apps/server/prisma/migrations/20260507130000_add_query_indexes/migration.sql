-- Composite + foreign-key indexes covering hot query paths:
--   * project page filters tasks by (projectId, status) for kanban columns
--   * subtask tree walks tasks by (projectId, parentTaskId)
--   * predecessor lookups walk Dependency by toTaskId
--     (the existing UNIQUE(fromTaskId, toTaskId) only covers fromTaskId
--      via leftmost-prefix matching).

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_projectId_parentTaskId_idx" ON "Task"("projectId", "parentTaskId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Dependency_toTaskId_idx" ON "Dependency"("toTaskId");
