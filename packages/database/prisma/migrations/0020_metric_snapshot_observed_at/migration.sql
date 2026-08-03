BEGIN;

ALTER TABLE "MetricSnapshot" ADD COLUMN "observedAt" TIMESTAMPTZ(3);

-- Existing revisions are immutable in production. Drop only the UPDATE trigger
-- inside this transaction for the one controlled metadata backfill; any error
-- rolls the trigger drop and all data changes back together.
DROP TRIGGER "MetricSnapshot_immutable_revision" ON "MetricSnapshot";
UPDATE "MetricSnapshot" SET "observedAt" = "capturedAt";
CREATE TRIGGER "MetricSnapshot_immutable_revision" BEFORE UPDATE ON "MetricSnapshot"
FOR EACH ROW EXECUTE FUNCTION protect_metric_snapshot_revision();

ALTER TABLE "MetricSnapshot" ALTER COLUMN "observedAt" SET NOT NULL;
ALTER TABLE "MetricSnapshot" ALTER COLUMN "observedAt" SET DEFAULT CURRENT_TIMESTAMP;

COMMIT;
