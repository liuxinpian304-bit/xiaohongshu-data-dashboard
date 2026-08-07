# Multi-Account Login Card Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the large single-account login panel with responsive real-account cards that each retain an identity-safe sync button.

**Architecture:** Extend the local collector sync boundary with an optional target account ID and reject identity mismatches before collection starts. Render database-backed `self-scrape` accounts as independent client-side cards while keeping the current collector session as the authority for whether a card may sync.

**Tech Stack:** NestJS, Prisma, Next.js 15, React 19, Vitest, Testing Library.

## Global Constraints

- Every real account card has its own sync button below the avatar and identity.
- A sync may start only when the collector session identity matches the selected account.
- The collector maintains one current login session; credentials and cookies never enter the webpage or database.
- Existing connector explanations and account-management list remain available.
- Every coherent code task is committed and pushed to `origin/main`.

---

### Task 1: Target-account sync guard

**Files:**
- Modify: `apps/api/src/local-collector/local-collector.controller.ts`
- Modify: `apps/api/src/local-collector/local-collector.service.ts`
- Modify: `apps/api/src/local-collector/local-collector.service.spec.ts`
- Modify: `apps/api/src/common/api.dto.ts`
- Modify: `apps/web/app/api/control/local-collector/[action]/route.ts`

**Interfaces:**
- Consumes: `POST /local-collector/sync` body `{ accountId?: string }` and authenticated collector identity.
- Produces: `startSync(accountId?: string)` that throws `collector_identity_mismatch` before collection when the selected database account is absent, not `self-scrape`, or has a different stable platform ID.

- [ ] Write failing tests for matching and mismatching target accounts.
- [ ] Run the local collector service test and verify the mismatch test fails for missing behavior.
- [ ] Add `LocalCollectorSyncDto`, controller body validation, target-account lookup, and identity comparison.
- [ ] Permit only `accountId` through the web BFF sync action.
- [ ] Run API tests, web BFF tests, and both typechecks.
- [ ] Commit with `feat: guard account-specific local sync` and push `HEAD:main`.

### Task 2: Responsive account login cards

**Files:**
- Replace behavior in: `apps/web/components/self-import-login.tsx`
- Modify tests: `apps/web/components/self-import-login.spec.tsx`
- Modify: `apps/web/app/(dashboard)/accounts/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `accounts: Array<{ id, platformId, xhsAccountId, displayName, avatarUrl, identityVerifiedAt }>` containing only `self-scrape` accounts.
- Produces: `SelfImportLogin({ accounts })` with one account card per item, per-card sync, and one “登录新账号” card.

- [ ] Write failing component tests for multiple cards, independent sync payloads, mismatch copy, and QR expansion.
- [ ] Run the component test and verify it fails against the single-panel component.
- [ ] Refactor the component into account cards plus an expandable login card while reusing existing status polling.
- [ ] Filter and pass real accounts from the server page.
- [ ] Add responsive card-grid styles and preserve the lower connector/account sections.
- [ ] Run all web tests and typecheck.
- [ ] Commit with `feat: add multi-account login cards` and push `HEAD:main`.

### Task 3: Deploy and verify

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: completed API and web changes.
- Produces: deployed `/accounts` page with verified per-account sync controls.

- [ ] Run affected API and web suites serially against an isolated test database only.
- [ ] Install revision using `zsh ops/macos/xhs-services.sh install '11111'`.
- [ ] Verify PostgreSQL, Redis, web, API, and collector health.
- [ ] Browser-check desktop card row, account identity, sync button placement, login-card expansion, mobile wrapping, and console errors.
- [ ] Verify `origin/main..HEAD` is empty and preserve unrelated dirty files.
