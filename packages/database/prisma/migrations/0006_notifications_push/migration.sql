ALTER TABLE "Notification"
  ADD COLUMN "eventId" TEXT,
  ADD COLUMN "type" TEXT,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "body" TEXT,
  ADD COLUMN "link" TEXT,
  ADD COLUMN "readAt" TIMESTAMPTZ(3);

UPDATE "Notification"
SET "eventId" = "id"::text,
    "type" = COALESCE("payload"->>'type', 'sync_completed'),
    "title" = COALESCE("payload"->>'title', '通知'),
    "body" = COALESCE("payload"->>'body', ''),
    "link" = COALESCE("payload"->>'link', '/');

ALTER TABLE "Notification"
  ALTER COLUMN "eventId" SET NOT NULL,
  ALTER COLUMN "type" SET NOT NULL,
  ALTER COLUMN "title" SET NOT NULL,
  ALTER COLUMN "body" SET NOT NULL,
  ALTER COLUMN "link" SET NOT NULL,
  DROP COLUMN "channel",
  DROP COLUMN "status",
  DROP COLUMN "payload",
  DROP COLUMN "sentAt";

CREATE UNIQUE INDEX "Notification_eventId_key" ON "Notification"("eventId");

CREATE TABLE "PushSubscription" (
  "id" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
