ALTER TABLE "SyncJob"
ADD COLUMN "externalJobId" TEXT,
ADD COLUMN "currentStage" TEXT NOT NULL DEFAULT 'authorize',
ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'verified';

CREATE UNIQUE INDEX "SyncJob_externalJobId_key" ON "SyncJob"("externalJobId");

CREATE TABLE "SyncCheckpoint" (
  "id" UUID NOT NULL,
  "syncJobId" UUID NOT NULL,
  "stage" TEXT NOT NULL,
  "entityKey" TEXT NOT NULL,
  "cursor" TEXT,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SyncCheckpoint_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SyncCheckpoint_syncJobId_stage_entityKey_key"
ON "SyncCheckpoint"("syncJobId", "stage", "entityKey");
