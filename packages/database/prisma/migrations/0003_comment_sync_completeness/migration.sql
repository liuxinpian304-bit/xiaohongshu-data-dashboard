CREATE TABLE "CommentSyncCompleteness" (
  "id" UUID NOT NULL,
  "connectorType" TEXT NOT NULL,
  "accountId" UUID NOT NULL,
  "notePlatformId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "cursor" TEXT,
  "error" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CommentSyncCompleteness_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommentSyncCompleteness_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CommentSyncCompleteness_connectorType_accountId_notePlatformId_key"
ON "CommentSyncCompleteness"("connectorType", "accountId", "notePlatformId");
