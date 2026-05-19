-- AlterTable: add parentTaskId for task hierarchy (subtasks).
-- onDelete: SetNull — children become top-level when parent deleted.
ALTER TABLE "Task" ADD COLUMN "parentTaskId" TEXT REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for child-of-X lookups and the project tasks GET that derives hasChildren.
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");
