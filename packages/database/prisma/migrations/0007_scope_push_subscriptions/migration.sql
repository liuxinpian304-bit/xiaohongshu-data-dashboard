ALTER TABLE "PushSubscription" ADD COLUMN "accountId" UUID;
DELETE FROM "PushSubscription" WHERE "accountId" IS NULL;
ALTER TABLE "PushSubscription" ALTER COLUMN "accountId" SET NOT NULL;
DROP INDEX "PushSubscription_endpoint_key";
CREATE UNIQUE INDEX "PushSubscription_accountId_endpoint_key" ON "PushSubscription"("accountId", "endpoint");
CREATE INDEX "PushSubscription_accountId_idx" ON "PushSubscription"("accountId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
