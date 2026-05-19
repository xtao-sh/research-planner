-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "estimateO" INTEGER NOT NULL,
    "estimateM" INTEGER NOT NULL,
    "estimateP" INTEGER NOT NULL,
    "size" TEXT NOT NULL DEFAULT 'm',
    "confidence" REAL,
    "priority" INTEGER NOT NULL,
    "labels" TEXT,
    "assignee" TEXT,
    "startPlanned" DATETIME,
    "endPlanned" DATETIME,
    "dueSoft" DATETIME,
    "dueHard" DATETIME,
    "milestoneId" TEXT,
    "notes" TEXT,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assignee", "confidence", "dueHard", "dueSoft", "endPlanned", "estimateM", "estimateO", "estimateP", "id", "labels", "milestoneId", "notes", "priority", "projectId", "startPlanned", "status", "title", "type") SELECT "assignee", "confidence", "dueHard", "dueSoft", "endPlanned", "estimateM", "estimateO", "estimateP", "id", "labels", "milestoneId", "notes", "priority", "projectId", "startPlanned", "status", "title", "type" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: derive `size` T-shirt from existing PERT `estimateM` (hours).
UPDATE "Task" SET "size" = 'xs' WHERE "estimateM" <= 1;
UPDATE "Task" SET "size" = 's'  WHERE "estimateM" > 1  AND "estimateM" <= 4;
UPDATE "Task" SET "size" = 'm'  WHERE "estimateM" > 4  AND "estimateM" <= 8;
UPDATE "Task" SET "size" = 'l'  WHERE "estimateM" > 8  AND "estimateM" <= 24;
UPDATE "Task" SET "size" = 'xl' WHERE "estimateM" > 24;
