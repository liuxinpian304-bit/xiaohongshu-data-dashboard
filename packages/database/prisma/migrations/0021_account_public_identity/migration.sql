ALTER TABLE "Account" ADD COLUMN "xhsAccountId" TEXT;
ALTER TABLE "Account" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "Account" ADD COLUMN "identityVerifiedAt" TIMESTAMPTZ(3);
