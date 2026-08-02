# Task 8 Report: 查询与任务控制 API

## Scope delivered

- Added protected REST modules for accounts, jobs, notes, comments, dashboard, and reports with cursor pagination.
- Replaced the temporary `x-admin-token` guard with an Argon2id password login and database-backed opaque sessions.
- Added expiring/revocable HttpOnly SameSite=Strict sessions, production Secure cookies, database-backed login throttling, CSRF binding, Origin checks, and Fetch Metadata checks.
- Added AES-256-GCM credential encryption using a 32-byte environment key, random 12-byte IV, 16-byte tag, and account/credential AAD.
- Added audited account authorization, reauthorization, deactivation, deletion, sync control, and push notification configuration without secret values.
- Added scoped CSV comment export with spreadsheet-formula neutralization and background jobs above 100,000 records.
- Added safe runtime DTO validation, sanitized error responses, explicit metric availability, and OpenAPI at `/docs` plus `/docs/openapi.json`.

## TDD evidence

### RED

- Added dashboard/auth e2e tests and credential cipher tests before implementation.
- Initial e2e invocation failed before route collection because `@nestjs/testing` was absent; after adding the test dependency the new routes/auth behavior were still absent and required implementation.
- During GREEN expansion, authenticated login initially returned 500 because Vitest did not emit constructor metadata; explicit injection fixed the real HTTP path.

### GREEN

- `pnpm --filter api test`: 5 files, 10 tests passed.
- `pnpm --filter api test:e2e`: 2 files, 6 tests passed against PostgreSQL.
- `pnpm --filter api typecheck`: passed.
- `pnpm --filter api build`: passed.
- `pnpm --filter @xhs/database prisma:migrate`: 11 migrations found, no pending migrations.

## Security self-check

- No alternate header-token auth or in-memory session store remains.
- Session tokens and CSRF tokens are stored only as SHA-256 hashes; CSRF comparison is timing-safe.
- Password configuration accepts only `ADMIN_PASSWORD_HASH`; credential encryption key is read from `CREDENTIAL_ENCRYPTION_KEY`.
- Cookie-authenticated mutations require a bound CSRF header and reject cross-site Origin/Fetch Metadata.
- Error bodies do not contain stacks; audit details exclude passwords, session values, CSRF tokens, and connector secrets.
- Repository scan found no `ADMIN_API_TOKEN`, `x-admin-token`, `MemoryStore`, eval-like sinks, or secret logging in the changed API/database scope.

## Security review fix round 1

### RED evidence

- Pre-session CSRF/auth e2e: 9 tests failed with `/auth/csrf` returning 404 before the double-submit flow existed.
- Session rotation: preserved old cookie returned 200 instead of the required 401.
- Parallel throttling: six simultaneous wrong guesses all passed the pre-check; no request received 429.
- Connector revocation: mock capability lacked revocation and account deletion never called it.
- Credential lifecycle: replacement failure coverage established that the old credential must remain.
- CSV export: stream was absent and a three-row export did not route to the configured two-row background threshold.
- Notification audit: audit failure left one unaudited push subscription behind.
- Cipher malformed payloads leaked Node crypto errors instead of the stable credential-format error.
- OpenAPI representative schema assertions initially exposed missing response/body/header/media contracts.

### GREEN implementation

- Added same-origin `GET /auth/csrf`, random double-submit cookie/token, strict login and mutation Origin/Fetch Metadata enforcement, post-login token rotation, logout revocation, expiry checks, prior-session rotation, and production Secure cookies.
- Added Argon2id PHC startup validation with minimum `m=65536,t=3,p=1` and rejection of Argon2i/Argon2d.
- Added PostgreSQL advisory transaction locks for per-admin/client-IP and global login buckets; normalized IPs and explicit disabled-by-default fixed-hop/CIDR trust proxy configuration.
- Extended connector capability/contracts with optional authorization revocation, implemented mock revocation, and made local credential/account/audit changes transactional after successful revocation. Missing formal connectors report `unsupported`.
- Changed authorization and reauthorization to transactional create/swap/delete with the audit row in the same transaction.
- Changed CSV export to repeatable-read threshold discovery, a fixed ID snapshot, chunked `Readable` output, formula neutralization, row and byte thresholds, and scoped background job payloads containing account IDs and filters.
- Made notification audit mandatory and executed audit plus push-subscription upsert in one transaction.
- Added strict ISO date and range validation, named API DTOs, and documented cookie auth, CSRF header, path/query/body contracts, 200/202/error responses, pagination, and CSV media.
- Hardened encrypted credential parsing to exactly four fields, 12-byte IV, 16-byte tag, non-empty ciphertext, and deterministic failures.

### Final verification

- API unit/integration: 10 files, 30 tests passed.
- API e2e: 2 files, 16 tests passed against PostgreSQL.
- Worker: 12 files, 65 tests passed.
- Domain: 3 files, 18 tests passed.
- Database integration: 2 files, 5 tests passed.
- Connector: 1 file, 11 tests passed.
- API, worker, domain, database, and connector typechecks passed; API and worker builds passed.
- PostgreSQL 18 container reported healthy; Prisma found 12 migrations and no pending migration.
