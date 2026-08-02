-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "connectorType" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorCapability" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "connectorType" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricDefinition" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "metricDefinitionId" UUID NOT NULL,
    "value" DECIMAL(20,4) NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "noteId" UUID,
    "connectorType" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "parentPlatformId" TEXT,
    "content" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncStep" (
    "id" UUID NOT NULL,
    "syncJobId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "SyncStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "reportType" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportMetric" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "metricDefinitionId" UUID NOT NULL,
    "value" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "ReportMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_connectorType_platformId_key" ON "Account"("connectorType", "platformId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_accountId_kind_key" ON "Credential"("accountId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorCapability_accountId_capability_key" ON "ConnectorCapability"("accountId", "capability");

-- CreateIndex
CREATE INDEX "Note_accountId_publishedAt_idx" ON "Note"("accountId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Note_connectorType_platformId_key" ON "Note"("connectorType", "platformId");

-- CreateIndex
CREATE UNIQUE INDEX "MetricDefinition_key_key" ON "MetricDefinition"("key");

-- CreateIndex
CREATE INDEX "MetricSnapshot_capturedAt_idx" ON "MetricSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_noteId_metricDefinitionId_capturedAt_key" ON "MetricSnapshot"("noteId", "metricDefinitionId", "capturedAt");

-- CreateIndex
CREATE INDEX "Comment_noteId_publishedAt_idx" ON "Comment"("noteId", "publishedAt");

-- CreateIndex
CREATE INDEX "Comment_connectorType_parentPlatformId_idx" ON "Comment"("connectorType", "parentPlatformId");

-- CreateIndex
CREATE UNIQUE INDEX "Comment_connectorType_platformId_key" ON "Comment"("connectorType", "platformId");

-- CreateIndex
CREATE INDEX "SyncJob_accountId_createdAt_idx" ON "SyncJob"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncStep_syncJobId_name_key" ON "SyncStep"("syncJobId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Report_accountId_reportType_periodStart_periodEnd_key" ON "Report"("accountId", "reportType", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ReportMetric_reportId_metricDefinitionId_key" ON "ReportMetric"("reportId", "metricDefinitionId");

-- CreateIndex
CREATE INDEX "Notification_accountId_createdAt_idx" ON "Notification"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorCapability" ADD CONSTRAINT "ConnectorCapability_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_metricDefinitionId_fkey" FOREIGN KEY ("metricDefinitionId") REFERENCES "MetricDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncStep" ADD CONSTRAINT "SyncStep_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportMetric" ADD CONSTRAINT "ReportMetric_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportMetric" ADD CONSTRAINT "ReportMetric_metricDefinitionId_fkey" FOREIGN KEY ("metricDefinitionId") REFERENCES "MetricDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
