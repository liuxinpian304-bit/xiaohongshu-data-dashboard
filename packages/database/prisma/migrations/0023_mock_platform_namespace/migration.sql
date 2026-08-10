DROP INDEX "Account_platform_platformId_key";
CREATE UNIQUE INDEX "Account_platform_platformId_non_mock_key" ON "Account"("platform", "platformId") WHERE "source" <> 'mock';

DROP INDEX "Note_platform_platformId_key";
CREATE UNIQUE INDEX "Note_platform_platformId_non_mock_key" ON "Note"("platform", "platformId") WHERE "source" <> 'mock';

DROP INDEX "Comment_platform_platformId_key";
CREATE UNIQUE INDEX "Comment_platform_platformId_non_mock_key" ON "Comment"("platform", "platformId") WHERE "source" <> 'mock';
