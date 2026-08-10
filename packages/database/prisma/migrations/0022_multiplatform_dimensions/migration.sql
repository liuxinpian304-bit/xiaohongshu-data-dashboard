ALTER TABLE "Account" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'xiaohongshu';
ALTER TABLE "Account" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'legacy';
UPDATE "Account"
SET "source" = CASE
  WHEN "connectorType" = 'self-scrape' THEN 'self-scrape'
  WHEN "connectorType" IN ('official', 'mock') THEN "connectorType"
  ELSE 'legacy'
END;

ALTER TABLE "Note" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'xiaohongshu';
ALTER TABLE "Note" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "Note" ADD COLUMN "contentKind" TEXT NOT NULL DEFAULT 'note';
UPDATE "Note"
SET "source" = CASE
  WHEN "connectorType" = 'self-scrape' THEN 'self-scrape'
  WHEN "connectorType" IN ('official', 'mock') THEN "connectorType"
  ELSE 'legacy'
END;

ALTER TABLE "Comment" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'xiaohongshu';
ALTER TABLE "MetricDefinition" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'xiaohongshu';

CREATE UNIQUE INDEX "Account_platform_platformId_key" ON "Account"("platform", "platformId");

CREATE UNIQUE INDEX "Note_platform_platformId_key" ON "Note"("platform", "platformId");

CREATE UNIQUE INDEX "Comment_platform_platformId_key" ON "Comment"("platform", "platformId");
CREATE INDEX "Comment_platform_noteId_publishedAt_idx" ON "Comment"("platform", "noteId", "publishedAt");

DROP INDEX "MetricDefinition_key_source_version_key";
CREATE UNIQUE INDEX "MetricDefinition_platform_key_source_version_key" ON "MetricDefinition"("platform", "key", "source", "version");
