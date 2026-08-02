ALTER TABLE "BackfillEvent"
  ADD COLUMN "claimedAt" TIMESTAMPTZ(3),
  ADD COLUMN "claimToken" TEXT;
