# Chinese Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully Chinese `/settings` page that replaces the English framework 404 and safely reports local dashboard status.

**Architecture:** Add one authenticated API status projection that combines database and collector health without exposing secrets. Add a server-rendered Next.js settings route that consumes this projection and degrades individual status cards to Chinese error states.

**Tech Stack:** NestJS, Prisma, Next.js 15, React 19, Vitest, Testing Library.

## Global Constraints

- All user-facing settings text and errors are Chinese.
- The page never exposes passwords, cookies, collector tokens, database addresses, or sensitive file paths.
- The settings page is read-only and only links to existing account management.
- Unauthenticated administrators are redirected to `/login?next=/settings`.

---

### Task 1: Safe settings status API

**Files:**
- Create: `apps/api/src/settings/settings.controller.ts`
- Create: `apps/api/src/settings/settings.service.ts`
- Create: `apps/api/src/settings/settings.service.spec.ts`
- Create: `apps/api/src/settings/settings.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/common/api.dto.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**
- Consumes: Prisma `$queryRaw` connectivity and `LocalCollectorService.action('status')`.
- Produces: `GET /settings/status` returning `{ api, database, collector, account, version, timezone }` with status values `healthy | unhealthy | disabled`.

- [ ] **Step 1: Write the failing service test**

Test that healthy dependencies return Chinese-page-safe status data, collector failure becomes `unhealthy`, and no returned key contains `token`, `password`, `cookie`, `url`, or `path`.

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter api test -- src/settings/settings.service.spec.ts`
Expected: FAIL because the settings service does not exist.

- [ ] **Step 3: Implement the minimal status service and protected controller**

The service catches database and collector failures independently. The controller uses the existing `AuthGuard`; the DTO documents nullable account identity and health enums.

- [ ] **Step 4: Run API tests and typecheck**

Run: `pnpm --filter api test && pnpm --filter api typecheck && pnpm --filter api test:e2e`
Expected: all commands pass.

- [ ] **Step 5: Commit and push**

```bash
git add apps/api/src/settings apps/api/src/app.module.ts apps/api/src/common/api.dto.ts apps/api/src/main.ts
git commit -m "feat: expose safe settings status"
git push origin HEAD:main
```

### Task 2: Chinese settings page

**Files:**
- Create: `apps/web/app/(dashboard)/settings/page.tsx`
- Create: `apps/web/components/settings-overview.tsx`
- Create: `apps/web/components/settings-overview.spec.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `getSettingsStatus(): Promise<ApiResult<SettingsStatus>>`.
- Produces: authenticated `/settings` page with Chinese service, account, data-source, and system-information sections.

- [ ] **Step 1: Write the failing component test**

Render healthy, unhealthy, and no-account states. Assert Chinese labels “运行正常”“连接异常”“尚未连接账号”, an `/accounts` management link, and absence of credential-like text.

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter web test -- components/settings-overview.spec.tsx`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the page and overview component**

Use compact status cards for webpage, API, database, and collector. Add account identity, the three data-source descriptions, version, `Asia/Shanghai`, and the existing account-management link.

- [ ] **Step 4: Run web tests and typecheck**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: all tests pass with no TypeScript errors.

- [ ] **Step 5: Commit and push**

```bash
git add 'apps/web/app/(dashboard)/settings/page.tsx' apps/web/components/settings-overview.tsx apps/web/components/settings-overview.spec.tsx apps/web/lib/api.ts apps/web/app/globals.css
git commit -m "feat: add Chinese system settings page"
git push origin HEAD:main
```

### Task 3: Deployment and browser verification

**Files:**
- No source files expected.

**Interfaces:**
- Consumes: completed API and web settings implementation.
- Produces: deployed, visible `/settings` page in the persistent local services.

- [ ] **Step 1: Run final serial verification**

Run API tests, web tests, API end-to-end tests, and all affected typechecks serially. Expected: every suite passes.

- [ ] **Step 2: Install the current revision into persistent services**

Run: `zsh ops/macos/xhs-services.sh install '11111'`
Expected: web, API, collector, PostgreSQL, and Redis report healthy after startup.

- [ ] **Step 3: Verify in a browser**

Open `/settings`, verify no English 404 appears, all four status cards render Chinese states, and “前往账号管理” targets `/accounts`. Check the browser console has no errors.

- [ ] **Step 4: Confirm Git state**

Verify `origin/main..HEAD` is empty and preserve unrelated user files without staging them.
