ALTER TABLE "Report"
  ADD COLUMN "missingFields" JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN "backfillId" TEXT,
  ADD COLUMN "rebuildJobId" TEXT,
  ADD COLUMN "previousReportId" UUID,
  ADD COLUMN "rebuildReason" TEXT;

CREATE INDEX "Report_backfillId_idx" ON "Report"("backfillId");

CREATE TABLE "BackfillEvent" (
  "id" TEXT NOT NULL,
  "accountId" UUID NOT NULL,
  "noteId" UUID NOT NULL,
  "capturedDates" TEXT[] NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'metric_snapshot_saved',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BackfillEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackfillEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BackfillEvent_accountId_createdAt_idx" ON "BackfillEvent"("accountId", "createdAt");
