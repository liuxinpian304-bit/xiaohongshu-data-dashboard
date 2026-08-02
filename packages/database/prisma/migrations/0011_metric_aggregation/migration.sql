CREATE TYPE "MetricAggregation" AS ENUM ('cumulative_delta', 'sum_interval', 'period_end', 'deduplicated_period');
ALTER TABLE "MetricDefinition" ADD COLUMN "aggregation" "MetricAggregation" NOT NULL DEFAULT 'cumulative_delta';
