ALTER TABLE "Account"
  ADD COLUMN "revocationState" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "revocationRetainData" BOOLEAN,
  ADD COLUMN "revocationRequestedAt" TIMESTAMPTZ(3),
  ADD COLUMN "revocationFailure" TEXT;

ALTER TABLE "Account" ADD CONSTRAINT "Account_revocationState_check"
CHECK ("revocationState" IN ('none', 'pending', 'failed', 'unknown', 'completed'));
