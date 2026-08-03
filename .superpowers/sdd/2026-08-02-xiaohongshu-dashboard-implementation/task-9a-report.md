# Task 9A report — historical metric provenance

## Outcome

Focused commit: `5695450 fix: preserve historical metric provenance`.

- Added immutable, effective-dated metric-definition versions using half-open intervals and a PostgreSQL exclusion constraint per `(key, source)`.
- Added append-only metric evidence revisions. Exact observations are no-ops; corrections link to their predecessor and leave one active head.
- Added report evidence references (`snapshotId`, `revision`) and exposed them in the report API schema.
- Reports resolve definitions by period, reject incompatible in-period transitions explicitly, combine compatible covered segments, and read only active evidence heads.
- Dashboard queries read only active evidence heads and definitions effective in the selected period.

## RED evidence

- `pnpm --filter worker test -- report.service.spec.ts`: future definitions and incompatible transitions failed with `metric_definition_missing` before effective-period resolution.
- `pnpm --filter worker exec vitest run src/sync/sync.service.spec.ts -t 'metric replays|concurrent conflicting' --no-file-parallelism`: old identity upsert could not represent revisions and both correction tests failed.
- Compatible transition test initially returned `awaiting_data`; it passed only after segment-boundary coverage and aggregation were implemented.

## GREEN evidence

- Worker: 12 files, 81 tests passed on a freshly migrated database.
- API: 11 files, 52 tests passed when run sequentially (API and worker integration suites mutate the same test database and must not run concurrently).
- Database: 2 files, 5 integration tests passed.
- Domain: 3 files, 21 tests passed; connector: 1 file, 11 tests passed; web: 6 files, 18 tests passed.
- All workspace typechecks passed; Next.js, API and worker production builds passed.

## Migration verification

- Fresh database `xhs_task9a_fresh`: all 15 migrations, including `0013_historical_metric_provenance`, applied successfully.
- Upgrade database `xhs_task9a_upgrade`: migrations through `0012` were applied, representative official v1/v2 and mock definitions, snapshots and a report were inserted, then `0013` applied successfully.
- Upgrade assertions confirmed official v1 closed at v2's first evidence, v2 remained open, both snapshots became active revision 1 rows, and the old report received its historical evidence reference.
- Database constraints/triggers prevent overlapping definition intervals and any evidence mutation other than atomically superseding an active head.

## Concurrency and provenance

- Transaction-scoped advisory locks serialize definition activation and each snapshot identity.
- Concurrent conflicting observations produced revisions `1, 2, 3` with exactly one active head; exact replay did not append evidence.
- Correction outbox identity includes an observation digest so a correction schedules a rebuild while an exact replay remains idempotent.
- Old report versions retain their original evidence JSON; rebuilt versions store the currently selected revisions.

## Commands

- `pnpm --filter worker test`
- `pnpm --filter api test`
- `pnpm --filter @xhs/database test:integration`
- `pnpm -r --workspace-concurrency=1 --if-present typecheck`
- `pnpm -r --workspace-concurrency=1 --if-present build`

## Concerns

- Integration suites share one PostgreSQL database, so API and worker tests must remain sequential; a parallel recursive test run causes unrelated cleanup deadlocks.
- Temporary verification databases were intentionally left available for reviewer inspection: `xhs_task9a_fresh` and `xhs_task9a_upgrade`.

## Fix round 1

Focused fix commit: `8409286 fix: enforce append-only metric evidence`.

- RED: dashboard accepted evidence without a definition-period filter; aggregation exposed no evidence trace; direct snapshot deletion succeeded; sync accepted observations selected against a closed definition.
- GREEN: dashboard now loads every effective segment, filters both period and baseline rows by definition ID and `[effectiveFrom,effectiveTo)`, and combines only compatible semantic series.
- `aggregateMetricSeriesWithTrace` returns the exact IDs used by cumulative, interval-sum, period-end and deduplicated aggregation. Reports persist only those successful trace IDs and revisions; tests confirm a non-authoritative period-end row is excluded.
- Migration `0014_append_only_evidence` marks all pre-trace reports `legacy_incomplete` with empty evidence references instead of claiming false reproducibility. New reports default to complete provenance.
- Snapshot DELETE is rejected by a database trigger. Snapshot-to-note, note-to-account and report-to-account foreign keys are RESTRICT. Account deletion requests retain and deactivate records whenever historical notes or reports exist.
- Sync validates observation time and authoritative windows against the selected definition interval before writing, including closed-version and out-of-window tests.
- Fresh deployment through 0014 passed. Upgrade of the representative 0013 database passed; its report became `legacy_incomplete:0`, and a direct snapshot DELETE failed with the append-only error.
- Final sequential evidence: domain 22, connector 11, web 18, API 54, worker 83 and database 6 tests passed; all workspace typechecks and production builds passed.

## Fix round 2

- Dashboard and reports now prove cumulative coverage per definition segment. A new segment requires its own exact transition baseline; a closed old segment requires boundary evidence at `effectiveTo - 1ms`. Segment deltas are summed without treating a cross-version counter jump as growth; gaps return `not_synced`, including trend points.
- Sync rejects aggregation/version semantic mismatches, one-sided or reversed windows, observations outside `[effectiveFrom,effectiveTo)`, and windows extending outside that interval.
- Migration `0015_runtime_evidence_permissions` blocks runtime truncation, removes runtime `UPDATE/DELETE/TRUNCATE` privileges from evidence, and exposes only a security-definer function for closing an active revision. Compose initialization, split migration/runtime URLs, deployment guidance and startup privilege verification were added.
- Runtime-role verification returned `f|f|f` for update/delete/truncate and each direct mutation was denied. Fresh deployment through all 17 migrations and representative upgrade through 0015 passed.
- Account removal now locks the account row and performs remote revocation, history checks, credential/capability changes, conditional deletion and audit in one interactive transaction. Revocation failure rolls back unchanged state; concurrent note insertion is serialized by the row lock/FK.
- Final sequential verification: API 56, worker 83 and database 7 tests passed; domain 22, connector 11 and web 18 remained green; every workspace typecheck and production build passed.

## Fix round 3

- Focused implementation commit: `1314dae fix: harden metric provenance lifecycle` (design/plan commit: `3f9d5a2`).
- Dashboard RED proved the final card could be `12/available` while the final trend point was `null/not_synced` because the trend received definitions compressed by metric key. Cards and trend now pass the complete effective-dated segments into the same `seriesDeltas`; complete compatible transitions agree, and either missing boundary leaves both `not_synced`.
- Sync RED proved a second observation with the same aggregation but `official-v2` metadata was accepted into the `official-v1` definition. Every observation now requires the selected definition's key, source, aggregation, and version; the rejected batch writes zero snapshots.
- Account removal RED covered remote failure remaining enabled, network I/O holding the account lock, lost retention intent on retry, finalization failure losing recoverable state, and repeated delete returning 404. Migration `0016_account_revocation_state` persists pending/failed/unknown/completed state and retention intent. Prepare and finalize are short locked transactions around external revocation; capabilities disable before the remote call, credentials survive failure, concurrent note/report inserts complete and force retention, and a real audit trigger proved phase-B rollback leaves pending state for an idempotent retry.
- Database startup RED covered missing `DATABASE_URL`, database owner, direct evidence mutation privileges, and incomplete test bypass. There is no owner fallback; API and worker verify by default, and bypass requires exactly `NODE_ENV=test` plus `DATABASE_ALLOW_PRIVILEGED_TEST_ROLE=true`.
- The unreleased `0015` no longer contains or creates a password and preserves its security-definer supersede function. Compose requires owner/runtime secrets. The runtime-role shell uses a psql variable and server-side `%L` quoting; a password containing quotes, SQL, semicolon, comment, dollar, and bang characters provisioned successfully without changing the postgres role.
- Fresh `xhs_task9a_round3_fresh` applied all 18 migrations with 18 successful and zero failed records. Representative `xhs_task9a_upgrade` retained 3 definitions, 2 snapshots, and 1 report while adding the revocation fields. Runtime login succeeded on both; it was neither superuser nor database owner, UPDATE/DELETE/TRUNCATE were all false and direct attempts were denied, while the security-definer function remained executable.
- Final sequential verification: domain 22, connector 11, web 18, API 60, worker 84, database 12. Every workspace typecheck and production build passed; `docker compose config --quiet` and `git diff --check` passed.

## Fix round 4

- RED: a real blocked remote revocation allowed `reauthorize` to replace the credential and reset revocation state; the old successful callback could then delete that new credential. A stale-operation test also failed because no persistent operation identity existed.
- Migration `0017_account_revocation_operation` adds a persistent UUID operation id, backfills in-flight revocations, enforces the state/token invariant, and indexes the CAS key. Prepare generates a cryptographically random UUID for a new intent and reuses it for `pending`/`failed`/`unknown` retries.
- `authorize` and `reauthorize` lock an existing account and return HTTP 409 until revocation is `none` or `completed`. Success and failure callbacks use `(accountId, operationId, pending)` CAS. A stale callback cannot delete credentials or overwrite a newer state; duplicate callbacks return the single completed result and create one completion audit.
- Account responses now use an explicit public projection, so revocation state, failure details, retention intent, and operation tokens never leak through account APIs.
- The published `0015` file was restored byte-for-byte to `f092465`. Forward migration `0017` immediately sets the historical placeholder role password to `NULL`; deployment documentation requires the external-secret provision script after all migrations and before API/worker startup.
- Fresh verification applied all 19 migrations. A real TCP login with `runtime_change_me` failed with PostgreSQL `28P01`; post-migration provisioning with an external secret logged in as `xhs_runtime`. Upgrade verification from 0016 backfilled a pending account with a non-null UUID and left the runtime role password null.
- Final sequential verification: domain 22, connector 11, web 18, worker 84, API 64, API E2E 28, and database 7. All workspace typechecks and production builds passed; `git diff --check` passed.
