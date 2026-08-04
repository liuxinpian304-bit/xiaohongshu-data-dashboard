# Xiaohongshu Account Identity and Persistent Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `local-creator` placeholder with the authenticated Xiaohongshu identity, bind every import to that identity, and reuse the persistent local browser session until Xiaohongshu invalidates it.

**Architecture:** The collector extracts a redacted public identity from the authenticated creator page and returns it with session status. The API validates and upserts that identity into the existing `self-scrape` Account, then uses its stable platform ID for collection imports. The web renders the verified identity and explicit session state; the current persistent Chromium profile remains the single-account session foundation without changing mock or official connector behavior.

**Tech Stack:** TypeScript 5.9, Playwright, Node HTTP, NestJS 11, Prisma/PostgreSQL, Next.js 15, React 19, Vitest and Testing Library.

## Global Constraints

- Keep the existing mock demonstration unchanged.
- Keep the future official API connector path unchanged and do not refactor the connector interface.
- Never return or log cookies, local storage, tokens, QR contents, or filesystem profile paths.
- Treat `(connectorType, platformId)` as the account ownership boundary.
- Stop synchronization on missing or mismatched authenticated identity; never fall back to `local-creator`.
- Preserve the Chromium persistent profile across normal collector close and restart; require a new QR scan only after expiry, verification, or an intentional account change.
- This plan delivers accurate identity and persistent single-account login first. Parallel multi-account profile management follows on the same identity contract in a separate plan.

---

## File Structure

- `apps/collector/src/xhs-account-identity.ts`: strict public identity type and parser for bounded creator responses/DOM data.
- `apps/collector/src/xhs-account-identity.spec.ts`: parser acceptance, rejection, and secret-redaction tests.
- `apps/collector/src/xhs-page-adapter.ts`: captures same-origin creator responses and exposes `readAccountIdentity()`.
- `apps/collector/src/xhs-page-adapter.spec.ts`: page-adapter identity extraction tests.
- `apps/collector/src/session-manager.ts`: attaches verified identity to authenticated status and validates identity before collection.
- `apps/collector/src/session-manager.spec.ts`: persistence and mismatch regression tests.
- `apps/collector/src/server.ts` and `apps/collector/src/server.spec.ts`: preserve the identity in the redacted session API contract.
- `packages/database/prisma/schema.prisma` and `packages/database/prisma/migrations/0021_account_public_identity/migration.sql`: store avatar and last identity verification timestamp.
- `apps/api/src/local-collector/local-collector.service.ts`: validates collector identity, upserts Account, and passes the verified platform ID to the importer.
- `apps/api/src/local-collector/local-collector.service.spec.ts`: binding, mismatch, and no-placeholder tests.
- `apps/api/src/accounts/accounts.service.ts` and its integration spec: expose the new public projection.
- `apps/web/lib/api.ts`: extend the public Account type.
- `apps/web/components/self-import-login.tsx` and its spec: render verified login identity and correct invalid-session language.
- `apps/web/app/(dashboard)/accounts/page.tsx`: render avatar and verification timestamp on the account card.
- `apps/web/app/globals.css`: style the compact public identity card.

---

### Task 1: Parse and expose a safe Xiaohongshu public identity

**Files:**
- Create: `apps/collector/src/xhs-account-identity.ts`
- Create: `apps/collector/src/xhs-account-identity.spec.ts`
- Modify: `apps/collector/src/xhs-page-adapter.ts`
- Test: `apps/collector/src/xhs-page-adapter.spec.ts`

**Interfaces:**
- Produces: `XhsAccountIdentity = { platformId: string; xhsAccountId: string | null; displayName: string; avatarUrl: string | null }`.
- Produces: `parseXhsAccountIdentity(value: unknown): XhsAccountIdentity | null`.
- Produces: `XhsPageAdapter.readAccountIdentity(): Promise<XhsAccountIdentity>`; throws `collector_identity_unavailable` when no stable identity is proven.

- [ ] **Step 1: Write parser tests that accept bounded public identity fields and reject incomplete or secret-bearing payloads**

```ts
expect(parseXhsAccountIdentity({ user_id: '5f-stable', red_id: 'red_123', nickname: '吉祥', avatar: 'https://sns-avatar-qc.xhscdn.com/a.jpg' })).toEqual({
  platformId: '5f-stable', xhsAccountId: 'red_123', displayName: '吉祥', avatarUrl: 'https://sns-avatar-qc.xhscdn.com/a.jpg',
});
expect(parseXhsAccountIdentity({ nickname: '没有稳定 ID' })).toBeNull();
expect(JSON.stringify(parseXhsAccountIdentity({ user_id: 'u1', nickname: '账号', cookie: 'secret' }))).not.toContain('secret');
```

- [ ] **Step 2: Run the new parser test and verify RED**

Run: `pnpm --filter collector test -- src/xhs-account-identity.spec.ts`

Expected: FAIL because `xhs-account-identity.ts` does not exist.

- [ ] **Step 3: Implement strict recursive extraction with length and URL allowlists**

```ts
export interface XhsAccountIdentity { platformId: string; xhsAccountId: string | null; displayName: string; avatarUrl: string | null }

export function parseXhsAccountIdentity(value: unknown): XhsAccountIdentity | null {
  // Visit at most 2,000 plain-object/array nodes, accept platformId from
  // user_id/userId/id only beside nickname/name, and copy only the four
  // public fields into the returned object. Avatar must be HTTPS and at most
  // 2,048 characters; every text field has an explicit 200-character bound.
}
```

- [ ] **Step 4: Add adapter tests proving it consumes only JSON from Xiaohongshu creator origins and fails closed without identity**

```ts
await expect(adapter.readAccountIdentity()).resolves.toMatchObject({ platformId: 'user-stable', displayName: '真实昵称' });
await expect(adapterWithoutIdentity.readAccountIdentity()).rejects.toThrow('collector_identity_unavailable');
```

- [ ] **Step 5: Implement `readAccountIdentity()` using a temporary response listener and bounded settle loop**

```ts
async readAccountIdentity(): Promise<XhsAccountIdentity> {
  // Listen only while navigating to the creator home/note-manager page,
  // accept JSON <= 5 MB from creator.xiaohongshu.com, parse a public copy,
  // always detach the listener, and throw when no stable platform ID appears.
}
```

- [ ] **Step 6: Run collector tests and commit**

Run: `pnpm --filter collector test`

Expected: all collector tests PASS.

```bash
git add apps/collector/src/xhs-account-identity.ts apps/collector/src/xhs-account-identity.spec.ts apps/collector/src/xhs-page-adapter.ts apps/collector/src/xhs-page-adapter.spec.ts
git commit -m "feat: read authenticated xhs identity"
git push origin HEAD:main
```

### Task 2: Bind authenticated session state and collection to the proven identity

**Files:**
- Modify: `apps/collector/src/session-manager.ts`
- Modify: `apps/collector/src/session-manager.spec.ts`
- Modify: `apps/collector/src/server.ts`
- Modify: `apps/collector/src/server.spec.ts`

**Interfaces:**
- Consumes: `PageAdapter.readAccountIdentity(): Promise<XhsAccountIdentity>` from Task 1.
- Produces: `SessionStatus.identity?: XhsAccountIdentity` and `SessionStatus.identityVerifiedAt?: string` only when state is `authenticated`.
- Produces: collection events only after a second identity check matches the bound `platformId`.

- [ ] **Step 1: Write failing tests for authenticated identity, persistent restart behavior, and mismatch rejection**

```ts
expect(await manager.refresh()).toMatchObject({
  state: 'authenticated', identity: { platformId: 'user-1', displayName: '真实昵称' }, identityVerifiedAt: expect.any(String),
});
await expect(manager.collect(progress, emit, 'run-2')).rejects.toThrow('collector_identity_mismatch');
expect(JSON.stringify(manager.status())).not.toMatch(/cookie|storage|profile|token/i);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter collector test -- src/session-manager.spec.ts src/server.spec.ts`

Expected: FAIL because session status has no identity contract and collection does not compare identity.

- [ ] **Step 3: Implement verified status and fail-closed collection**

```ts
if (state === 'authenticated') {
  const identity = await this.adapter.readAccountIdentity!();
  this.boundPlatformId ??= identity.platformId;
  if (identity.platformId !== this.boundPlatformId) throw new Error('collector_identity_mismatch');
  this.current = { state, changedAt: now, identity, identityVerifiedAt: now };
}
```

Keep the persistent profile directory on `close()`. Do not serialize identity into the Chromium profile or any log.

- [ ] **Step 4: Extend server contract tests to allow only the explicit public identity keys**

```ts
expect(body.identity).toEqual({ platformId: 'user-1', xhsAccountId: 'red-1', displayName: '真实昵称', avatarUrl: null });
expect(JSON.stringify(body)).not.toMatch(/cookie|storage|token/i);
```

- [ ] **Step 5: Run collector tests and commit**

Run: `pnpm --filter collector test && pnpm --filter collector typecheck`

Expected: PASS.

```bash
git add apps/collector/src/session-manager.ts apps/collector/src/session-manager.spec.ts apps/collector/src/server.ts apps/collector/src/server.spec.ts
git commit -m "feat: bind collection to xhs identity"
git push origin HEAD:main
```

### Task 3: Persist the public identity and import into the correct Account

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0021_account_public_identity/migration.sql`
- Modify: `apps/api/src/local-collector/local-collector.service.ts`
- Modify: `apps/api/src/local-collector/local-collector.service.spec.ts`
- Modify: `apps/api/src/accounts/accounts.service.ts`
- Modify: `apps/api/src/accounts/accounts.service.integration.spec.ts`

**Interfaces:**
- Consumes: collector `SessionStatus.identity` from Task 2.
- Produces: Account fields `xhsAccountId: string | null`, `avatarUrl: string | null`, and `identityVerifiedAt: Date | null`.
- Produces: `bindAuthenticatedIdentity(status): Promise<AccountPublicProjection>` inside `LocalCollectorService`.
- Changes: `startSync()` first obtains and binds authenticated identity, then imports with `accountPlatformId: identity.platformId`.

- [ ] **Step 1: Write failing API tests proving same-identity upsert and removal of the placeholder fallback**

```ts
await service.startSync();
expect(importer).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ accountPlatformId: 'stable-user-1' }));
expect(await prisma.account.count({ where: { connectorType: 'self-scrape', platformId: 'stable-user-1' } })).toBe(1);
expect(await prisma.account.count({ where: { platformId: 'local-creator' } })).toBe(0);
```

Add a second test where the session status identity and collection-start identity differ; expect `collector_identity_mismatch` and zero importer calls.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter api test -- src/local-collector/local-collector.service.spec.ts src/accounts/accounts.service.integration.spec.ts`

Expected: FAIL because the public identity fields and binding method do not exist.

- [ ] **Step 3: Add the additive migration and Prisma fields**

```sql
ALTER TABLE "Account" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "Account" ADD COLUMN "xhsAccountId" TEXT;
ALTER TABLE "Account" ADD COLUMN "identityVerifiedAt" TIMESTAMPTZ(3);
```

```prisma
avatarUrl          String?
xhsAccountId       String?
identityVerifiedAt DateTime? @db.Timestamptz(3)
```

- [ ] **Step 4: Implement transactional identity binding and dynamic import ownership**

```ts
await db.account.upsert({
  where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: identity.platformId } },
  create: { connectorType: 'self-scrape', platformId: identity.platformId, xhsAccountId: identity.xhsAccountId, displayName: identity.displayName, avatarUrl: identity.avatarUrl, identityVerifiedAt },
  update: { xhsAccountId: identity.xhsAccountId, displayName: identity.displayName, avatarUrl: identity.avatarUrl, identityVerifiedAt },
});
```

Delete the `LOCAL_XHS_ACCOUNT_PLATFORM_ID ?? 'local-creator'` import fallback. A missing verified identity must fail before collection starts.

- [ ] **Step 5: Extend the public account projection without exposing credentials**

```ts
const publicAccountSelect = {
  id: true, connectorType: true, platformId: true, displayName: true,
  xhsAccountId: true, avatarUrl: true, identityVerifiedAt: true, createdAt: true, updatedAt: true, capabilities: true,
} as const;
```

- [ ] **Step 6: Generate Prisma client, run sequential database/API tests, and commit**

Run: `pnpm --filter @xhs/database prisma:generate && pnpm --filter api test -- src/local-collector/local-collector.service.spec.ts && pnpm --filter api test -- src/accounts/accounts.service.integration.spec.ts`

Expected: PASS. Run database-using suites sequentially to avoid shared test database interference.

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/0021_account_public_identity/migration.sql apps/api/src/local-collector/local-collector.service.ts apps/api/src/local-collector/local-collector.service.spec.ts apps/api/src/accounts/accounts.service.ts apps/api/src/accounts/accounts.service.integration.spec.ts
git commit -m "feat: persist verified xhs account identity"
git push origin HEAD:main
```

### Task 4: Show the accurate account and session state in the dashboard

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/self-import-login.tsx`
- Modify: `apps/web/components/self-import-login.spec.tsx`
- Modify: `apps/web/app/(dashboard)/accounts/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: public identity fields in Account and authenticated collector status.
- Produces: a visible account identity card with avatar, display name, Xiaohongshu ID, session state, and last verification timestamp.

- [ ] **Step 1: Write failing component tests for real identity and invalid-session copy**

```tsx
expect(await screen.findByRole('heading', { name: '真实昵称' })).toBeVisible();
expect(screen.getByText('小红书号：red_123')).toBeVisible();
expect(screen.getByText('登录有效')).toBeVisible();
```

For `expired`, assert `需要重新扫码` is visible and `账号已连接` is absent.

- [ ] **Step 2: Run web tests and verify RED**

Run: `pnpm --filter web test -- components/self-import-login.spec.tsx`

Expected: FAIL because identity is not rendered.

- [ ] **Step 3: Extend types and render only verified public fields**

```ts
export type Account = {
  id: string; connectorType: string; platformId: string; displayName: string | null;
  xhsAccountId: string | null; avatarUrl: string | null; identityVerifiedAt: string | null;
  capabilities: Array<{ enabled: boolean }>;
};
```

```tsx
{status?.identity ? <div className="xhs-account-identity">
  {status.identity.avatarUrl ? <img src={status.identity.avatarUrl} alt="" referrerPolicy="no-referrer" /> : null}
  <div><h2>{status.identity.displayName}</h2><span>小红书号：{status.identity.xhsAccountId ?? status.identity.platformId}</span></div>
</div> : null}
```

- [ ] **Step 4: Update the server-rendered account list and compact styling**

Render `displayName`, the public Xiaohongshu ID (`platformId` when no red ID exists), avatar with an empty alt attribute, and a localized `identityVerifiedAt`. Never label a `self-scrape` account as connected from database presence alone; the live session card owns that status.

- [ ] **Step 5: Run web tests, typecheck, build, and commit**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`

Expected: PASS.

```bash
git add apps/web/lib/api.ts apps/web/components/self-import-login.tsx apps/web/components/self-import-login.spec.tsx 'apps/web/app/(dashboard)/accounts/page.tsx' apps/web/app/globals.css
git commit -m "feat: show verified xhs account identity"
git push origin HEAD:main
```

### Task 5: Apply, restart, and verify the real persistent login flow

**Files:**
- Modify only if verification exposes a tested defect in files already listed above.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: running local services using migration 0021 and a browser-verified account page.

- [ ] **Step 1: Run the complete verification suite sequentially**

Run:

```bash
pnpm --filter collector test
pnpm --filter worker test
pnpm --filter api test
pnpm --filter api test:e2e
pnpm --filter web test
pnpm -r typecheck
pnpm --filter web build
```

Expected: every command exits 0. Do not run API and worker database integration suites in parallel.

- [ ] **Step 2: Apply the migration and restart collector, API, and web with their existing local secrets preserved**

Run the repository's existing database deploy/start commands. Preserve `ADMIN_PASSWORD_HASH`, collector bearer token, database URL, and profile directory in process environment; do not print them.

- [ ] **Step 3: Browser-verify the live account page**

Open `http://127.0.0.1:3000/accounts` and verify:

1. The current authenticated session shows the real nickname and Xiaohongshu ID.
2. Refreshing the page does not request a new QR scan.
3. “立即同步” completes and imports into the Account whose `platformId` equals the verified identity.
4. Restarting the collector reopens the same persistent profile and returns to `authenticated` without scanning when the platform session remains valid.
5. No browser console error or server log contains Cookie, storage state, token, or profile path data.

- [ ] **Step 4: Verify database ownership and final Git state**

Query counts grouped by Account and confirm notes, snapshots, comments, sync jobs, and notifications all reference the verified `self-scrape` Account; confirm no new `local-creator` Account was created.

Run: `git status --short && git log -5 --oneline`

Expected: only the user's pre-existing unrelated task report remains modified; all feature commits are present on `origin/main`.
