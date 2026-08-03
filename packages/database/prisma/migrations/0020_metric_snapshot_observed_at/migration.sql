ALTER TABLE "MetricSnapshot" ADD COLUMN "observedAt" TIMESTAMPTZ(3);
UPDATE "MetricSnapshot" SET "observedAt" = "capturedAt";
ALTER TABLE "MetricSnapshot" ALTER COLUMN "observedAt" SET NOT NULL;
ALTER TABLE "MetricSnapshot" ALTER COLUMN "observedAt" SET DEFAULT CURRENT_TIMESTAMP;
