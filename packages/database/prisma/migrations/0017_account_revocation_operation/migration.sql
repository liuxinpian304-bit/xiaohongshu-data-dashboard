ALTER TABLE "Account" ADD COLUMN "revocationOperationId" UUID;

UPDATE "Account"
SET "revocationOperationId" = gen_random_uuid()
WHERE "revocationState" IN ('pending', 'failed', 'unknown');

ALTER TABLE "Account" ADD CONSTRAINT "Account_revocation_operation_check"
CHECK (
  ("revocationState" IN ('pending', 'failed', 'unknown') AND "revocationOperationId" IS NOT NULL)
  OR "revocationState" IN ('none', 'completed')
);

CREATE INDEX "Account_id_revocationOperationId_revocationState_idx"
ON "Account"("id", "revocationOperationId", "revocationState");

-- 0015 is immutable and may have bootstrapped this unreleased development role
-- with a placeholder. A migrations-only deployment must never leave it usable.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xhs_runtime') THEN
    ALTER ROLE xhs_runtime PASSWORD NULL;
  END IF;
END $$;
