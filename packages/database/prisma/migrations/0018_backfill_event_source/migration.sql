ALTER TABLE "BackfillEvent"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "mode" TEXT,
  ADD COLUMN "businessDate" TEXT;

UPDATE "BackfillEvent" SET "source" = CASE
  WHEN reason = 'official_observation_committed' THEN 'official'
  WHEN reason = 'metric_snapshot_saved' THEN 'mock'
  ELSE 'legacy'
END;
