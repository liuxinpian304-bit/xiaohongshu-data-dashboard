CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "MetricDefinition" ADD COLUMN "effectiveFrom" TIMESTAMPTZ(3);
ALTER TABLE "MetricDefinition" ADD COLUMN "effectiveTo" TIMESTAMPTZ(3);

WITH raw AS (
  SELECT d.id, d."key", d.source,
         COALESCE(MIN(s."capturedAt"), d."createdAt") AS start_at
  FROM "MetricDefinition" d LEFT JOIN "MetricSnapshot" s ON s."metricDefinitionId" = d.id
  GROUP BY d.id
), ranked AS (
  SELECT id, start_at + (ROW_NUMBER() OVER (PARTITION BY "key", source, start_at ORDER BY id) - 1) * INTERVAL '1 millisecond' AS start_at
  FROM raw
)
UPDATE "MetricDefinition" d SET "effectiveFrom" = ranked.start_at FROM ranked WHERE ranked.id = d.id;

WITH bounds AS (
  SELECT id, LEAD("effectiveFrom") OVER (PARTITION BY "key", source ORDER BY "effectiveFrom", id) AS next_start
  FROM "MetricDefinition"
)
UPDATE "MetricDefinition" d SET "effectiveTo" = bounds.next_start FROM bounds WHERE bounds.id = d.id;

ALTER TABLE "MetricDefinition" ALTER COLUMN "effectiveFrom" SET NOT NULL;
ALTER TABLE "MetricDefinition" ALTER COLUMN "effectiveFrom" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MetricDefinition" ADD CONSTRAINT "MetricDefinition_valid_effective_interval"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE "MetricDefinition" ADD CONSTRAINT "MetricDefinition_no_effective_overlap"
  EXCLUDE USING gist ("key" WITH =, "source" WITH =, tstzrange("effectiveFrom", "effectiveTo", '[)') WITH &&);

ALTER TABLE "MetricSnapshot" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MetricSnapshot" ADD COLUMN "supersedesId" UUID;
ALTER TABLE "MetricSnapshot" ADD COLUMN "supersededAt" TIMESTAMPTZ(3);
ALTER TABLE "MetricSnapshot" ADD COLUMN "correctedAt" TIMESTAMPTZ(3);
ALTER TABLE "MetricSnapshot" ADD COLUMN "correctionReason" TEXT;
ALTER TABLE "MetricSnapshot" ADD COLUMN "sourceRunId" TEXT;
DROP INDEX "MetricSnapshot_noteId_metricDefinitionId_capturedAt_key";
CREATE UNIQUE INDEX "MetricSnapshot_noteId_metricDefinitionId_capturedAt_revision_key"
  ON "MetricSnapshot"("noteId", "metricDefinitionId", "capturedAt", "revision");
CREATE UNIQUE INDEX "MetricSnapshot_active_head_key"
  ON "MetricSnapshot"("noteId", "metricDefinitionId", "capturedAt") WHERE "supersededAt" IS NULL;
CREATE UNIQUE INDEX "MetricSnapshot_supersedesId_key" ON "MetricSnapshot"("supersedesId");
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "MetricSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_revision_valid" CHECK ("revision" > 0);

CREATE FUNCTION protect_metric_snapshot_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'supersededAt') IS DISTINCT FROM (to_jsonb(OLD) - 'supersededAt')
     OR OLD."supersededAt" IS NOT NULL OR NEW."supersededAt" IS NULL THEN
    RAISE EXCEPTION 'metric snapshot revisions are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "MetricSnapshot_immutable_revision" BEFORE UPDATE ON "MetricSnapshot"
FOR EACH ROW EXECUTE FUNCTION protect_metric_snapshot_revision();

CREATE FUNCTION protect_metric_definition_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'effectiveTo') IS DISTINCT FROM (to_jsonb(OLD) - 'effectiveTo')
     OR OLD."effectiveTo" IS NOT NULL OR NEW."effectiveTo" IS NULL THEN
    RAISE EXCEPTION 'metric definitions are immutable except for closing the active interval';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "MetricDefinition_immutable_version" BEFORE UPDATE ON "MetricDefinition"
FOR EACH ROW EXECUTE FUNCTION protect_metric_definition_version();

ALTER TABLE "Report" ADD COLUMN "evidenceRefs" JSONB NOT NULL DEFAULT '[]'::jsonb;
UPDATE "Report" r SET "evidenceRefs" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('snapshotId', s.id, 'revision', s.revision)
                   ORDER BY s."capturedAt", s.id)
  FROM "MetricSnapshot" s JOIN "Note" n ON n.id = s."noteId"
  WHERE n."accountId" = r."accountId" AND s."capturedAt" >= r."periodStart"
    AND s."capturedAt" <= r."periodEnd" AND s."supersededAt" IS NULL
), '[]'::jsonb);
