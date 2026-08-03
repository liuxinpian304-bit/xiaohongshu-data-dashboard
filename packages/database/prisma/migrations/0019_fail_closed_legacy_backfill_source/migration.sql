UPDATE "BackfillEvent"
SET "source" = 'legacy'
WHERE "source" = 'mock' AND "businessDate" IS NULL;
