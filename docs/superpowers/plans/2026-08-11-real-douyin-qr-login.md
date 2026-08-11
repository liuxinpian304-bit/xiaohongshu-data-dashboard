# Real Douyin QR Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unverified Xiaohuohua account placeholder with real Douyin creator-center QR login, persistent isolated sessions, verified identity, and account-scoped real-data synchronization.

**Architecture:** Add a Douyin session manager and page adapter beside the existing Xiaohongshu collector, expose loopback-only collector routes through authenticated API/Web BFF routes, and bind only verified identities into the shared multi-platform database. Reuse `PlatformCollectionEventV2` and the existing import pipeline for synchronized content, metrics, comments, and replies.

**Tech Stack:** TypeScript, Node.js, Playwright persistent Chromium contexts, NestJS, Next.js App Router, Prisma/PostgreSQL, Vitest, Testing Library, macOS launchd.

## Global Constraints

- Only accounts the user logs into and is authorized to access are in scope.
- Do not bypass CAPTCHA, SMS verification, risk controls, or access controls.
- Never store or log passwords, cookies, tokens, QR image bytes, or authorization request headers.
- Collector remains bound to `127.0.0.1` and requires the existing high-entropy bearer token.
- Session directories use mode `0700`; the identity mapping file uses mode `0600`.
- Only official Douyin creator domains are allowed.
- An account is not persisted or displayed as authenticated until a stable Douyin account ID is verified.
- Missing or incomplete data is never converted to zero.
- Every implementation task uses test-first development and ends in a pushed Git commit.
- The existing official API connector boundary remains available but unconfigured.
- The unrelated user-owned change in `.superpowers/sdd/2026-08-02-xiaohongshu-dashboard-implementation/task-5-report.md` must not be staged.

---

## File Structure

- `apps/collector/src/douyin/douyin-types.ts`: public session, identity, and collection contracts.
- `apps/collector/src/douyin/douyin-page-adapter.ts`: official-domain login detection, QR capture, identity parsing, and creator response collection.
- `apps/collector/src/douyin/douyin-session-store.ts`: secure multi-session directory and identity-map persistence.
- `apps/collector/src/douyin/douyin-session-manager.ts`: per-account state machine and Playwright lifecycle.
- `apps/collector/src/douyin/douyin-collection.ts`: converts bounded creator responses to `PlatformCollectionEventV2`.
- `apps/collector/src/douyin/douyin-registry.ts`: creates, restores, lists, and closes isolated sessions.
- `apps/collector/src/server.ts`: loopback collector routes only.
- `apps/api/src/douyin-local/*`: validates collector responses, binds verified accounts, starts imports, and exposes authenticated API routes.
- `apps/web/app/api/control/douyin/*`: same-origin BFF routes; no browser-to-collector access.
- `apps/web/components/douyin-login.tsx`: QR login, polling, account cards, relogin, and sync controls.
- `apps/web/app/(dashboard)/accounts/page.tsx`: replaces fake discovery UI with verified account UI.
- `ops/macos/xhs-services.sh`: configures the secure Douyin profile root and keeps local services persistent.

---

### Task 1: Remove the Fake Authenticated Account Contract

**Files:**
- Modify: `apps/collector/src/xiaohuohua/account-discovery.ts`
- Modify: `apps/collector/src/server.ts`
- Modify: `apps/api/src/local-collector/local-collector.service.ts`
- Modify: `apps/web/components/douyin-account-discovery.tsx`
- Test: `apps/collector/src/xiaohuohua/account-discovery.spec.ts`
- Test: `apps/web/components/douyin-account-discovery.spec.tsx`

**Interfaces:**
- Produces: Xiaohuohua visible labels are diagnostic only and can never have `loginState: 'authenticated'`.
- Produces: `GET /v2/accounts` no longer feeds unverified Douyin accounts into account management.

- [ ] **Step 1: Write failing tests that reject visible-name authentication**

```ts
it('does not promote a visible Xiaohuohua label to an authenticated Douyin account', async () => {
  const accounts = await discoverAccounts(fakeSurface(['Tonic']));
  expect(accounts).toEqual([]);
});
```

```tsx
it('never describes an unverified Xiaohuohua label as logged in', async () => {
  render(<DouyinAccountDiscovery />);
  expect(screen.queryByText('抖音 · 登录有效')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm --filter collector test -- account-discovery.spec.ts && pnpm --filter web test -- douyin-account-discovery.spec.tsx`

Expected: FAIL because the current implementation emits `loginState: 'authenticated'` and renders “登录有效”.

- [ ] **Step 3: Remove the promotion path**

Make `discoverAccounts()` return no account records until a stable official identity exists. Change the old component to a migration notice only; do not insert or update `Account` rows from `/v2/accounts`.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter collector test -- account-discovery.spec.ts server.spec.ts && pnpm --filter web test -- douyin-account-discovery.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add apps/collector/src/xiaohuohua apps/collector/src/server.ts apps/api/src/local-collector apps/web/components/douyin-account-discovery.tsx apps/web/components/douyin-account-discovery.spec.tsx
git commit -m "fix: stop treating visible Douyin labels as authenticated"
git push origin HEAD:main
```

### Task 2: Secure Persistent Douyin Session Store

**Files:**
- Create: `apps/collector/src/douyin/douyin-types.ts`
- Create: `apps/collector/src/douyin/douyin-session-store.ts`
- Test: `apps/collector/src/douyin/douyin-session-store.spec.ts`
- Modify: `ops/macos/xhs-services.sh`
- Test: `ops/macos/xhs-services.test.sh`

**Interfaces:**
- Produces: `DouyinIdentity = { platformId: string; douyinAccountId: string; displayName: string; avatarUrl: string | null }`.
- Produces: `DouyinSessionRecord = { sessionId: string; platformId: string | null; profileDirectory: string; identityVerifiedAt: string | null }`.
- Produces: `DouyinSessionStore.create()`, `.list()`, `.bindIdentity()`, and `.remove()`.

- [ ] **Step 1: Write permission and traversal tests**

```ts
it('creates isolated 0700 profiles and a 0600 identity map', async () => {
  const store = new DouyinSessionStore(root);
  const record = await store.create();
  expect((await stat(record.profileDirectory)).mode & 0o777).toBe(0o700);
  await store.bindIdentity(record.sessionId, identity, verifiedAt);
  expect((await stat(join(root, 'sessions.json'))).mode & 0o777).toBe(0o600);
});

it.each(['../escape', '/absolute', 'a/b'])('rejects invalid session id %s', async (sessionId) => {
  await expect(store.open(sessionId)).rejects.toThrow('invalid_douyin_session_id');
});
```

- [ ] **Step 2: Run test and confirm failure**

Run: `pnpm --filter collector test -- douyin-session-store.spec.ts`

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement atomic secure persistence**

Use `randomUUID()` for internal IDs, `mkdir(..., { mode: 0o700 })`, `chmod`, bounded JSON parsing, write-to-temporary-file plus `rename`, and `chmod(..., 0o600)`. Store no browser storage values.

- [ ] **Step 4: Add runtime profile root**

In `run_service collector`, export:

```zsh
export LOCAL_DOUYIN_PROFILE_ROOT="$SERVICE_HOME/douyin-profiles"
mkdir -p "$LOCAL_DOUYIN_PROFILE_ROOT"
chmod 700 "$LOCAL_DOUYIN_PROFILE_ROOT"
```

- [ ] **Step 5: Verify tests and commit**

Run: `pnpm --filter collector test -- douyin-session-store.spec.ts && zsh ops/macos/xhs-services.test.sh`

```bash
git add apps/collector/src/douyin/douyin-types.ts apps/collector/src/douyin/douyin-session-store.ts apps/collector/src/douyin/douyin-session-store.spec.ts ops/macos/xhs-services.sh ops/macos/xhs-services.test.sh
git commit -m "feat: add secure Douyin session storage"
git push origin HEAD:main
```

### Task 3: Official Douyin Login Adapter and State Machine

**Files:**
- Create: `apps/collector/src/douyin/douyin-page-adapter.ts`
- Create: `apps/collector/src/douyin/douyin-page-adapter.spec.ts`
- Create: `apps/collector/src/douyin/douyin-session-manager.ts`
- Create: `apps/collector/src/douyin/douyin-session-manager.spec.ts`

**Interfaces:**
- Consumes: `DouyinIdentity`, `DouyinSessionRecord` from Task 2.
- Produces: `DouyinSessionStatus` with states `idle | launching | awaiting_scan | authenticated | verification_required | expired | error | closed`.
- Produces: `DouyinSessionManager.start()`, `.status()`, `.refresh()`, `.qr()`, `.close()`.

- [ ] **Step 1: Write failing adapter tests**

```ts
it('accepts only official creator pages and requires a stable identity', async () => {
  const adapter = new DouyinPageAdapter(pageAt('https://creator.douyin.com/creator-micro/home'));
  await expect(adapter.readIdentity()).resolves.toEqual({
    platformId: 'douyin:7390000000000000000', douyinAccountId: 'tonic123', displayName: 'Tonic', avatarUrl: null,
  });
});

it('rejects redirects outside the official allowlist', async () => {
  await expect(new DouyinPageAdapter(pageAt('https://evil.test/login')).detectLoginState()).rejects.toThrow('douyin_origin_rejected');
});
```

- [ ] **Step 2: Write failing state-machine tests**

```ts
it('persists identity only after official verification', async () => {
  const manager = managerWith({ detectLoginState: async () => 'authenticated', readIdentity: async () => identity });
  await expect(manager.start()).resolves.toMatchObject({ state: 'authenticated', identity });
  expect(store.bindIdentity).toHaveBeenCalledOnce();
});

it('does not bypass security verification', async () => {
  await expect(managerWith(verificationAdapter).start()).resolves.toMatchObject({ state: 'verification_required' });
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run: `pnpm --filter collector test -- douyin-page-adapter.spec.ts douyin-session-manager.spec.ts`

Expected: FAIL because the adapter and manager do not exist.

- [ ] **Step 4: Implement login detection, QR capture, and identity verification**

Launch `chromium.launchPersistentContext(profileDirectory, { headless: false, channel: 'chrome' })`, navigate to the official creator login URL, validate every current URL against an exact hostname allowlist, and copy QR PNG bytes only into an in-memory expiring snapshot. Parse only bounded JSON responses from allowed origins; normalize the stable ID with the `douyin:` prefix.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter collector test -- douyin-page-adapter.spec.ts douyin-session-manager.spec.ts`

```bash
git add apps/collector/src/douyin/douyin-page-adapter.ts apps/collector/src/douyin/douyin-page-adapter.spec.ts apps/collector/src/douyin/douyin-session-manager.ts apps/collector/src/douyin/douyin-session-manager.spec.ts
git commit -m "feat: add real Douyin QR sessions"
git push origin HEAD:main
```

### Task 4: Multi-Account Registry and Collector Routes

**Files:**
- Create: `apps/collector/src/douyin/douyin-registry.ts`
- Test: `apps/collector/src/douyin/douyin-registry.spec.ts`
- Modify: `apps/collector/src/server.ts`
- Test: `apps/collector/src/server.spec.ts`

**Interfaces:**
- Consumes: `DouyinSessionStore`, `DouyinSessionManager`.
- Produces: `DouyinRegistry.createSession()`, `.listSessions()`, `.status(sessionId)`, `.qr(sessionId)`, `.close(sessionId)`.
- Produces collector routes:
  - `POST /v3/douyin/sessions`
  - `GET /v3/douyin/sessions`
  - `GET /v3/douyin/sessions/:sessionId`
  - `GET /v3/douyin/sessions/:sessionId/qr`
  - `POST /v3/douyin/sessions/:sessionId/refresh`
  - `DELETE /v3/douyin/sessions/:sessionId`

- [ ] **Step 1: Write failing registry and route tests**

```ts
expect(await call(port, 'POST', '/v3/douyin/sessions', token)).toMatchObject({
  status: 201, body: { sessionId: expect.any(String), state: expect.any(String) },
});
expect(await call(port, 'GET', `/v3/douyin/sessions/${sessionId}`, 'wrong')).toMatchObject({ status: 401 });
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter collector test -- douyin-registry.spec.ts server.spec.ts`

Expected: FAIL with route 404 and missing registry.

- [ ] **Step 3: Implement bounded routing and registry isolation**

Validate `sessionId` before lookup, cap sessions returned per response, use exact method/path matches, set `Cache-Control: no-store`, and preserve the existing bearer-token guard.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter collector test -- douyin-registry.spec.ts server.spec.ts`

```bash
git add apps/collector/src/douyin/douyin-registry.ts apps/collector/src/douyin/douyin-registry.spec.ts apps/collector/src/server.ts apps/collector/src/server.spec.ts
git commit -m "feat: expose isolated Douyin login sessions"
git push origin HEAD:main
```

### Task 5: Verified Account Binding and API/BFF Routes

**Files:**
- Create: `apps/api/src/douyin-local/douyin-local.service.ts`
- Create: `apps/api/src/douyin-local/douyin-local.service.spec.ts`
- Create: `apps/api/src/douyin-local/douyin-local.controller.ts`
- Create: `apps/api/src/douyin-local/douyin-local.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/web/app/api/control/douyin/sessions/route.ts`
- Create: `apps/web/app/api/control/douyin/sessions/[sessionId]/route.ts`
- Create: `apps/web/app/api/control/douyin/sessions/[sessionId]/qr/route.ts`
- Test: corresponding `route.spec.ts` files beside each route.

**Interfaces:**
- Consumes: Task 4 collector routes.
- Produces: authenticated `/douyin-local/sessions` API and same-origin `/api/control/douyin/sessions` Web BFF.
- Produces: `bindVerifiedDouyinIdentity(identity, verifiedAt)` upserts `platform=douyin`, `source=self-scrape`, `connectorType=douyin-local`.

- [ ] **Step 1: Write failing service tests**

```ts
it('binds only authenticated stable identities', async () => {
  await expect(service.status(sessionId)).resolves.toMatchObject({ state: 'authenticated' });
  expect(db.account.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ platform: 'douyin', source: 'self-scrape', connectorType: 'douyin-local' }),
  }));
});

it('rejects unknown response fields before database access', async () => {
  fetcher.mockResolvedValue(Response.json({ state: 'authenticated', cookie: 'secret' }));
  await expect(service.status(sessionId)).rejects.toThrow('invalid_douyin_collector_response');
  expect(db.account.upsert).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter api test -- douyin-local.service.spec.ts && pnpm --filter web test -- 'api/control/douyin'`

Expected: FAIL because modules and routes do not exist.

- [ ] **Step 3: Implement strict collector client and authenticated forwarding**

Allowlist response keys and value lengths, never forward collector bearer tokens to the browser, apply existing `AuthGuard`, `forwardMutation`, CSRF, same-origin, payload-size, and `no-store` rules. Bind accounts only after `state === 'authenticated'` and a validated identity is present.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter api test -- douyin-local.service.spec.ts && pnpm --filter api typecheck && pnpm --filter web test && pnpm --filter web typecheck`

```bash
git add apps/api/src/douyin-local apps/api/src/app.module.ts apps/web/app/api/control/douyin
git commit -m "feat: bridge verified Douyin sessions into the dashboard"
git push origin HEAD:main
```

### Task 6: Account-Page Real Login Experience

**Files:**
- Create: `apps/web/components/douyin-login.tsx`
- Create: `apps/web/components/douyin-login.spec.tsx`
- Modify: `apps/web/app/(dashboard)/accounts/page.tsx`
- Modify: `apps/web/app/(dashboard)/accounts/page.spec.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: Task 5 BFF routes.
- Produces: `DouyinLogin` component with create, poll, QR, verified card, relogin, close, and sync actions.

- [ ] **Step 1: Write failing interaction tests**

```tsx
it('shows an official QR flow and renders identity only after verification', async () => {
  render(<DouyinLogin initialSessions={[]} />);
  await user.click(screen.getByRole('button', { name: '登录新的抖音账号' }));
  expect(await screen.findByRole('img', { name: '抖音登录二维码' })).toHaveAttribute('src', expect.stringContaining('/api/control/douyin/sessions/'));
  expect(await screen.findByText('Tonic')).toBeVisible();
  expect(screen.getByText('抖音号：tonic123')).toBeVisible();
});

it('never renders the old fake authenticated copy', async () => {
  render(<DouyinLogin initialSessions={[]} />);
  expect(screen.queryByText('已通过小火花连接')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter web test -- douyin-login.spec.tsx accounts/page.spec.tsx`

Expected: FAIL because `DouyinLogin` does not exist.

- [ ] **Step 3: Implement the component**

Poll every two seconds only while state is transitional, stop on unmount and terminal states, refresh expired QR images with cache-busting query strings, show security-verification instructions without automation, and refresh the server page after verified binding. Keep the sync button beneath each verified account avatar.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter web test -- douyin-login.spec.tsx accounts/page.spec.tsx && pnpm --filter web typecheck`

```bash
git add apps/web/components/douyin-login.tsx apps/web/components/douyin-login.spec.tsx apps/web/app/'(dashboard)'/accounts/page.tsx apps/web/app/'(dashboard)'/accounts/page.spec.tsx apps/web/app/globals.css
git commit -m "feat: add real Douyin login to account management"
git push origin HEAD:main
```

### Task 7: Real Douyin Collection and Import

**Files:**
- Create: `apps/collector/src/douyin/douyin-collection.ts`
- Create: `apps/collector/src/douyin/douyin-collection.spec.ts`
- Modify: `apps/collector/src/douyin/douyin-page-adapter.ts`
- Modify: `apps/collector/src/douyin/douyin-session-manager.ts`
- Modify: `apps/collector/src/server.ts`
- Modify: `apps/api/src/douyin-local/douyin-local.service.ts`
- Modify: `apps/api/src/douyin-local/douyin-local.controller.ts`
- Test: `apps/api/src/douyin-local/douyin-local.service.spec.ts`

**Interfaces:**
- Produces: `collectDouyinEvents(identity, payloads, runId, capturedAt): PlatformCollectionEventV2[]`.
- Produces: `POST /v3/douyin/sessions/:sessionId/collection/start` and account-scoped status/events routes.
- Consumes: existing `importPlatformCollection(events, { platform: 'douyin', source: 'self-scrape', accountPlatformId, runId })`.

- [ ] **Step 1: Write failing fixture-driven collection tests**

```ts
it('emits verified content, metrics, every loaded comment, replies, and completeness', () => {
  const events = collectDouyinEvents(identity, fixturePayloads, 'run-1', capturedAt);
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'content', platform: 'douyin', source: 'self-scrape' }),
    expect.objectContaining({ type: 'metric', metric: expect.objectContaining({ key: 'views', availability: 'available' }) }),
    expect.objectContaining({ type: 'comment' }),
    expect.objectContaining({ type: 'completeness', status: 'page_complete', reason: 'platform_end' }),
  ]));
});

it('marks repeated cursors incomplete instead of claiming completion', () => {
  expect(() => pager.next({ cursor: 'same', hasMore: true })).toThrow('douyin_repeated_cursor');
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter collector test -- douyin-collection.spec.ts && pnpm --filter api test -- douyin-local.service.spec.ts`

Expected: FAIL because real collection is not implemented.

- [ ] **Step 3: Implement bounded pagination and event conversion**

Capture only allowed official JSON responses, cap individual responses at 5 MB, cap page count at 1,000, detect repeated cursors, require explicit platform-end signals for `page_complete`, preserve unavailable metrics as `not_synced` or `not_provided`, and reverify the session identity before collection.

- [ ] **Step 4: Import events and publish status**

The API starts an account-scoped collection only when the verified session identity matches the selected database account. Import events through `importPlatformCollection`, update the sync job, and publish existing success/failure/incomplete notifications.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter collector test && pnpm --filter api test && pnpm --filter collector typecheck && pnpm --filter api typecheck`

```bash
git add apps/collector/src/douyin apps/collector/src/server.ts apps/api/src/douyin-local
git commit -m "feat: synchronize real Douyin creator data"
git push origin HEAD:main
```

### Task 8: Production Database Isolation, Cleanup, Deployment, and Live Verification

**Files:**
- Modify: `apps/api/vitest.config.ts`
- Modify: `apps/api/vitest.e2e.config.ts`
- Modify: `apps/worker/vitest.config.ts`
- Modify: `packages/database/vitest.config.ts`
- Modify: integration-test fallback URLs under `apps/worker/src`.
- Create: `packages/database/src/remove-unverified-douyin.ts`
- Test: `packages/database/src/remove-unverified-douyin.spec.ts`
- Modify: `package.json`
- Modify: `ops/macos/README.md`

**Interfaces:**
- Produces: all tests use `xhs_dashboard_test`, never `xhs_dashboard`.
- Produces: `pnpm db:remove-unverified-douyin -- --commit` removes only `platform=douyin` rows lacking verified local identity, with dry-run default.

- [ ] **Step 1: Write database isolation and cleanup tests**

```ts
it('refuses to run destructive test setup against the runtime database', () => {
  expect(() => assertTestDatabase('postgresql://localhost/xhs_dashboard')).toThrow('runtime_database_forbidden');
  expect(assertTestDatabase('postgresql://localhost/xhs_dashboard_test')).toBeUndefined();
});

it('selects only unverified Douyin placeholders', async () => {
  expect(await findUnverifiedDouyin(db)).toEqual([expect.objectContaining({ connectorType: 'xiaohuohua', identityVerifiedAt: null })]);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @xhs/database test -- remove-unverified-douyin.spec.ts`

Expected: FAIL because the guard and cleanup tool do not exist.

- [ ] **Step 3: Isolate tests and implement dry-run cleanup**

Change every test URL to database `xhs_dashboard_test`, add a fail-closed database-name assertion before integration cleanup, and make placeholder deletion require both `--commit` and the explicit unverified predicate. Preserve verified accounts and historical business rows unless the deletion transaction proves they belong only to the placeholder.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
zsh ops/macos/xhs-services.test.sh
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit and push**

```bash
git add apps/api/vitest.config.ts apps/api/vitest.e2e.config.ts apps/worker/vitest.config.ts packages/database/vitest.config.ts apps/worker/src packages/database/src/remove-unverified-douyin.ts packages/database/src/remove-unverified-douyin.spec.ts package.json ops/macos/README.md
git commit -m "fix: isolate tests and remove unverified Douyin placeholders"
git push origin HEAD:main
```

- [ ] **Step 6: Deploy without replacing runtime secrets**

Checkout the verified commit in `~/Library/Application Support/xiaohongshu-dashboard/app`, run `pnpm install --frozen-lockfile --ignore-scripts`, regenerate Prisma Client, and reload all three LaunchAgents. Do not rerun `render` or overwrite `runtime.env`.

- [ ] **Step 7: Perform live acceptance**

Verify all services are healthy, then in the real browser:

1. Open `/accounts` and confirm no fake “抖音账号” is marked logged in.
2. Click “登录新的抖音账号” and scan the official QR.
3. Confirm real nickname, Douyin ID, avatar, verified time, and sync button.
4. Restart collector and verify the session restores without another scan.
5. Run one sync and confirm real content, metrics, comments, and completeness appear in dashboard pages.
6. Confirm logs and database contain no cookie, token, password, or QR bytes.

- [ ] **Step 8: Record final deployment commit**

```bash
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

Expected: only the unrelated user-owned report file may remain modified; `HEAD` and `origin/main` match.
