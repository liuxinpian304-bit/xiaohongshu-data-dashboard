ALTER TABLE "MetricDefinition" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "MetricDefinition" ADD COLUMN "version" TEXT NOT NULL DEFAULT 'legacy-v1';
DROP INDEX "MetricDefinition_key_key";
CREATE UNIQUE INDEX "MetricDefinition_key_source_version_key" ON "MetricDefinition"("key", "source", "version");

ALTER TABLE "MetricSnapshot" ADD COLUMN "aggregation" "MetricAggregation" NOT NULL DEFAULT 'cumulative_delta';
ALTER TABLE "MetricSnapshot" ADD COLUMN "aggregationVersion" TEXT NOT NULL DEFAULT 'legacy-v1';
ALTER TABLE "MetricSnapshot" ADD COLUMN "windowStart" TIMESTAMPTZ(3);
ALTER TABLE "MetricSnapshot" ADD COLUMN "windowEnd" TIMESTAMPTZ(3);
ALTER TABLE "MetricSnapshot" ADD COLUMN "authoritativePeriod" BOOLEAN NOT NULL DEFAULT false;

UPDATE "MetricSnapshot" SET "aggregation" = 'cumulative_delta', "aggregationVersion" = 'legacy-v1';
