-- Drop Project.ownerId and make Project.workspaceId NOT NULL.
-- Assumes backfill has already been run so that every Project has a non-null workspaceId.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "startDate" DATETIME,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("createdAt", "description", "id", "name", "startDate", "updatedAt", "workspaceId")
SELECT "createdAt", "description", "id", "name", "startDate", "updatedAt", "workspaceId" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE INDEX "Project_workspaceId_idx" ON "Project"("workspaceId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
