-- Add the fuzzy "finish-in-about" bucket to Task. Both columns are nullable;
-- existing tasks are unaffected and remain bucket-less until the user opts in.
-- See @rp/shared TimeframeBucket for the enum-style values validated at the API.

ALTER TABLE "Task" ADD COLUMN "timeframeBucket" TEXT;
ALTER TABLE "Task" ADD COLUMN "timeframeAnchor" DATETIME;
