ALTER TABLE "BackfillEvent"
  ADD COLUMN "dispatchStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "dispatchedAt" TIMESTAMPTZ(3);

CREATE INDEX "BackfillEvent_dispatchStatus_createdAt_idx" ON "BackfillEvent"("dispatchStatus", "createdAt");
