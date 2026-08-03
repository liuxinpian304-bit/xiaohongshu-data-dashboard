ALTER TABLE "Report" ADD COLUMN "provenanceStatus" TEXT NOT NULL DEFAULT 'complete';
UPDATE "Report" SET "evidenceRefs" = '[]'::jsonb, "provenanceStatus" = 'legacy_incomplete';
ALTER TABLE "Report" ADD CONSTRAINT "Report_provenance_status_check" CHECK ("provenanceStatus" IN ('complete', 'legacy_incomplete'));

ALTER TABLE "MetricSnapshot" DROP CONSTRAINT "MetricSnapshot_noteId_fkey";
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Note" DROP CONSTRAINT "Note_accountId_fkey";
ALTER TABLE "Note" ADD CONSTRAINT "Note_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Report" DROP CONSTRAINT "Report_accountId_fkey";
ALTER TABLE "Report" ADD CONSTRAINT "Report_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_metric_snapshot_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'metric evidence is append-only and cannot be deleted';
END $$;
CREATE TRIGGER "MetricSnapshot_prevent_delete" BEFORE DELETE ON "MetricSnapshot"
FOR EACH ROW EXECUTE FUNCTION prevent_metric_snapshot_delete();
