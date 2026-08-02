DROP INDEX "Report_accountId_reportType_periodStart_periodEnd_key";

ALTER TABLE "Report"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'complete',
  ADD COLUMN "missingDates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE UNIQUE INDEX "Report_accountId_reportType_periodStart_periodEnd_version_key"
  ON "Report"("accountId", "reportType", "periodStart", "periodEnd", "version");
CREATE INDEX "Report_accountId_reportType_periodStart_periodEnd_idx"
  ON "Report"("accountId", "reportType", "periodStart", "periodEnd");
