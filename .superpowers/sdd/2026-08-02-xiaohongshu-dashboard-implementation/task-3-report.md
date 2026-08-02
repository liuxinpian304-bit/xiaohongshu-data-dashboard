# Task 3 Report: PostgreSQL 数据模型与评论幂等约束

## Status

DONE

## RED evidence

- Added `comment.repository.integration.spec.ts` before production database code.
- Ran `pnpm --filter @xhs/database test:integration`.
- Exit code: 1.
- Expected failure: Vitest could not resolve missing `./client` from the new integration suite.

## GREEN evidence

- Prisma Client generation with pinned Prisma 7.9.1: PASS.
- `prisma migrate deploy` against PostgreSQL 17: PASS; `0001_init` applied successfully on the first run and reported no pending migrations on the final run.
- Comment repository integration test against real PostgreSQL: PASS, 1 test / 1 file. Repeating `(xiaohongshu, comment-1001)` returned `created: false`, preserved one row, and updated `likeCount` to 9.
- Database package TypeScript check: PASS.
- Existing domain tests: PASS, 5 tests / 1 file.
- Frozen-lockfile install and Docker Compose configuration validation: PASS.

## Implementation

- Added all required models: `Account`, `Credential`, `ConnectorCapability`, `Note`, `MetricDefinition`, `MetricSnapshot`, `Comment`, `SyncJob`, `SyncStep`, `Report`, `ReportMetric`, `Notification`, and `AuditLog`.
- Added `(connectorType, platformId)` unique constraints to platform-owned `Account`, `Note`, and `Comment` records.
- Added the complete required comment observation fields and supporting indexes.
- Implemented `upsertComment` as create-then-update-on-PostgreSQL-unique-conflict, so the database constraint remains the concurrency boundary and the result reports whether the row was created.
- Added Prisma 7 `prisma.config.ts`, required custom generated-client output, and the PostgreSQL driver adapter.
- Added PostgreSQL 17 and Redis 7 Compose services with health checks and durable PostgreSQL storage.

## Files

- `docker-compose.yml`
- `pnpm-lock.yaml`
- `packages/database/.gitignore`
- `packages/database/package.json`
- `packages/database/tsconfig.json`
- `packages/database/prisma.config.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/0001_init/migration.sql`
- `packages/database/src/client.ts`
- `packages/database/src/index.ts`
- `packages/database/src/comment.repository.ts`
- `packages/database/src/comment.repository.integration.spec.ts`

## Self-review

- Scope is limited to the fact-storage layer; no synchronization or reporting business workflow was added.
- Repository return type explicitly matches `Promise<{ comment: Comment; created: boolean }>`.
- Generated Prisma client is ignored and reproducibly created by `prisma:generate`.
- Mutation check: removing the compound unique constraint permits duplicate rows; skipping the conflict update leaves `likeCount` at 3; returning the wrong created flag fails the integration test.

## Concerns

- Local port 5432 was already occupied by an unrelated `xingkong-cloud-link-postgres` container. To avoid modifying another project's state, this Compose stack defaults PostgreSQL to host port 55432 (`POSTGRES_PORT` remains configurable). All migration and integration evidence above used `localhost:55432`.

---

## Fix round 1 (2026-08-02)

### Status

DONE

This section supersedes the PostgreSQL 17 / Redis 7 version statements above.

### RED evidence

- Coverage added first in `packages/database/src/metric-availability.integration.spec.ts`.
- Command: `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/xhs_dashboard pnpm --filter @xhs/database exec vitest run src/metric-availability.integration.spec.ts`
- Exit code: 1.
- Output: `2 failed | 2 passed (4)`; both persistence cases failed with Prisma validation `Unknown argument availability` for `MetricSnapshot`.
- The failure demonstrated that the prior model could not store a zero availability state or a not-provided observation with a null value.

### GREEN implementation

- Upgraded Compose images to `postgres:18-alpine` and `redis:8-alpine`.
- Updated the PostgreSQL 18 volume target to `/var/lib/postgresql`, as required by the version-specific data layout in the PostgreSQL 18 official image.
- Added `MetricAvailability` values `zero`, `not_synced`, `awaiting_authorization`, `not_provided`, and `available`.
- Made `MetricSnapshot.value` and `ReportMetric.value` nullable and added mandatory `availability` to both models.
- Added database CHECK constraints to both tables:
  - `zero` requires value `0`;
  - `available` requires a non-null, non-zero value;
  - `not_synced`, `awaiting_authorization`, and `not_provided` require null.
- Expanded `test:integration` to execute every `*.integration.spec.ts` file.

### PostgreSQL 18 migration and GREEN evidence

- Recreated only this task's Compose volume, then ran `docker compose up -d --wait postgres redis`.
- Version output: `postgres (PostgreSQL) 18.4`; `Redis server v=8.10.0`.
- Command: `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/xhs_dashboard pnpm --filter @xhs/database prisma:migrate`
- Output: migration `0001_init` applied; `All migrations have been successfully applied.`
- Command: `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/xhs_dashboard pnpm --filter @xhs/database test:integration`
- Output: `2 passed (2)` test files and `5 passed (5)` tests.
- Verified behaviors:
  - zero availability stores decimal value `0`;
  - not-provided availability stores null;
  - a not-provided snapshot with value `1` is rejected by the database;
  - an available report metric with null is rejected by the database;
  - the original duplicate-comment integration behavior remains green.
- Constraint violations are asserted as Prisma `P2039`, preventing the invalid-combination tests from passing merely because of client-side unknown-field validation.

### Coverage files

- `packages/database/src/metric-availability.integration.spec.ts`: four availability/value persistence and rejection cases.
- `packages/database/src/comment.repository.integration.spec.ts`: original comment idempotency regression case, included in the full GREEN run.

### Concerns

- Host port 5432 remains occupied by an unrelated project, so PostgreSQL 18 verification used this stack's configurable default host port 55432.
