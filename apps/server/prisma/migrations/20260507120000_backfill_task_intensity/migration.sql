-- Backfill Task.intensity from size for existing rows where it's NULL.
UPDATE "Task" SET intensity = CASE LOWER(COALESCE(size, 'm'))
  WHEN 'xs' THEN 1
  WHEN 's'  THEN 2
  WHEN 'm'  THEN 3
  WHEN 'l'  THEN 4
  WHEN 'xl' THEN 5
  ELSE 3
END WHERE intensity IS NULL;
