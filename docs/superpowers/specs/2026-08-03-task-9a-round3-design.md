# Task 9A Round 3 Design

## Goal

Close four provenance and lifecycle gaps without changing unrelated dashboard, sync, or account behavior.

## Dashboard aggregation

The store returns every effective metric-definition segment. `DashboardService` must never replace that array with a map keyed only by metric key. Cards and every trend cutoff call the same `seriesDeltas` implementation with the complete definition segments. A separate unique-key projection may provide display labels, but it cannot participate in evidence selection. Compatible cumulative transitions require exact evidence at the new segment start and at one millisecond before a closed segment end; otherwise both cards and trend report `not_synced`.

## Sync validation

Each metric observation is validated independently against the definition selected for its key. Its metadata key, source, aggregation, and `aggregationVersion` must equal the selected definition's key, source, aggregation, and version. A batch may contain multiple keys but cannot use metadata for one definition version to write another definition.

## Revocation state machine

`Account` stores a revocation state and deletion intent. Phase A is a short locked transaction: load the account, determine historical retention, set `pending`, persist intent, disable all capabilities, retain credentials, and audit preparation. The remote connector call happens after commit. Phase B is another short locked transaction. Success deletes credentials and either deletes the account or retains it disabled, then audits completion. Failure records `failed` (or `unknown` for an indeterminate timeout), keeps capabilities disabled and credentials intact, and audits failure. A retry resumes from the persisted intent. If remote success is followed by a Phase B database failure, the account remains pending/disabled with credentials so a repeated idempotent remote revoke can finalize it.

## Database startup and provisioning

The database client has no owner fallback URL. API and worker startup always verify that the connected role is not an owner and lacks evidence UPDATE, DELETE, and TRUNCATE privileges. The only bypass requires both `NODE_ENV=test` and `DATABASE_ALLOW_PRIVILEGED_TEST_ROLE=true`. Compose requires an operator-provided runtime password; an entrypoint shell uses psql variables plus server-side `format('%L', ...)` quoting to create or alter the role without interpolating the secret into SQL. Migration `0015` keeps its security-definer correction function unchanged.

## Verification

Behavioral tests cover card/trend agreement, missing segment boundaries, wrong-version metric batches, remote failure and retry, concurrent history insertion/deletion, repeated delete, missing/owner database configuration, and the explicit test-only bypass. Fresh and representative upgrade migrations, runtime mutation denial, sequential workspace suites, typechecks, and production builds are required before completion.
