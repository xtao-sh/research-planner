-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Dependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromTaskId" TEXT NOT NULL,
    "toTaskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "lag" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Dependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Dependency_fromTaskId_fkey" FOREIGN KEY ("fromTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Dependency_toTaskId_fkey" FOREIGN KEY ("toTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Dependency" ("fromTaskId", "id", "projectId", "toTaskId", "type") SELECT "fromTaskId", "id", "projectId", "toTaskId", "type" FROM "Dependency";
DROP TABLE "Dependency";
ALTER TABLE "new_Dependency" RENAME TO "Dependency";
CREATE INDEX "Dependency_projectId_idx" ON "Dependency"("projectId");
CREATE UNIQUE INDEX "Dependency_fromTaskId_toTaskId_key" ON "Dependency"("fromTaskId", "toTaskId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
