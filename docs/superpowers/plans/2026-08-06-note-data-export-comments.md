# Note Data Export and Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make note metrics immediately visible, export all filtered note/comment data as one ZIP, and automatically show every stored comment on note detail pages.

**Architecture:** Extend the notes read model with account, latest-metric, and comment-completeness projections. Add a bounded server-side ZIP exporter with an authenticated BFF route, then implement a client-controlled table/card note explorer and an auto-paging comment viewer that preserves existing cursor safety and data-availability semantics.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js 15, React 19, TypeScript, Vitest, Node streams and buffers, CSS.

## Global Constraints

- Preserve mock, official API, and self-scrape sources and do not refactor the connector interface.
- Never display unknown metrics as zero.
- Export scope follows the selected managed account and ignores UI page boundaries.
- CSV is UTF-8 with BOM and ZIP contains exactly `notes.csv`, `comments.csv`, and `README.txt`.
- Comment auto-pagination stops on repeated/missing cursors and at 1,000 pages or 100,000 rows.
- Existing unrelated dirty report and `.next.corrupt-20260805-qa` remain untouched.
- Commit and push every coherent implementation task.

---

### Task 1: Project note metrics and comment completeness

**Files:**
- Modify: `apps/api/src/notes/notes.service.ts`
- Create: `apps/api/src/notes/notes.service.spec.ts`
- Modify: `apps/api/src/common/api.dto.ts`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/api.spec.ts`

**Interfaces:**
- Produces list item fields `account: { id, displayName, platformId }`, `metrics: NoteMetricProjection[]`, and `commentCompleteness: { status, error, updatedAt } | null`.
- `NoteMetricProjection` is `{ key, displayName, availability, value, source, observedAt }` and contains only the latest effective unsuperseded snapshot for each metric key.

- [ ] **Step 1: Write failing service tests**

Test that list projection selects the latest effective snapshot per key, preserves `not_provided` as `value: null`, joins the account label, and maps `CommentSyncCompleteness` using `(connectorType, accountId, platformId)`.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter api test -- src/notes/notes.service.spec.ts`
Expected: FAIL because list returns raw Note rows.

- [ ] **Step 3: Implement one shared projection**

Extract a private `projectMetrics` helper used by both `list` and `detail`. Query notes with account, latest candidate snapshots/definitions, and completeness records; return cursor pagination without changing cursor ordering.

- [ ] **Step 4: Update DTO/client contracts and tests**

Extend `Note` and `NoteDetail` types, add a parser-path test in `apps/web/lib/api.spec.ts`, and keep missing values nullable.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter api test -- src/notes/notes.service.spec.ts && pnpm --filter api typecheck && pnpm --filter web test -- lib/api.spec.ts && pnpm --filter web typecheck`

```bash
git add apps/api/src/notes apps/api/src/common/api.dto.ts apps/web/lib
git commit -m "feat: expose note data projections"
git push origin HEAD:main
```

### Task 2: Export filtered notes and comments as ZIP

**Files:**
- Create: `apps/api/src/notes/zip-writer.ts`
- Create: `apps/api/src/notes/zip-writer.spec.ts`
- Create: `apps/api/src/notes/note-export.service.ts`
- Create: `apps/api/src/notes/note-export.service.spec.ts`
- Modify: `apps/api/src/notes/notes.controller.ts`
- Modify: `apps/api/src/notes/notes.module.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/web/app/api/notes/export/route.ts`
- Create: `apps/web/app/api/notes/export/route.spec.ts`
- Create: `apps/web/components/note-export.tsx`
- Create: `apps/web/components/note-export.spec.tsx`

**Interfaces:**
- API: `GET /notes/export.zip?accountId=<uuid>` returns `application/zip` with attachment filename `xiaohongshu-data-YYYY-MM-DD.zip`.
- BFF: `GET /api/notes/export?accountId=<uuid>` accepts only `accountId` and forwards the authenticated stream.

- [ ] **Step 1: Write failing ZIP writer tests**

Build a ZIP with three UTF-8 entries and assert local headers, central directory, CRC32 values, entry names, and end record are readable by a small test parser. Assert duplicate and unsafe entry names are rejected.

- [ ] **Step 2: Verify RED and implement minimal store-mode ZIP writer**

Run: `pnpm --filter api test -- src/notes/zip-writer.spec.ts`
Expected: FAIL because writer is missing. Implement ZIP32 store mode with bounded entry buffers and CRC32; no arbitrary filesystem paths.

- [ ] **Step 3: Write failing export service tests**

Test BOM-prefixed CSV quoting/formula protection, all-page export beyond 50 rows, account filtering, availability columns, parent comment IDs, and exact three-entry manifest.

- [ ] **Step 4: Implement export service and controller**

Read notes/comments in 500-row chunks inside a repeatable-read transaction, cap at 100,000 rows and 50 MiB, construct `notes.csv`, `comments.csv`, and `README.txt`, then return ZIP bytes. Reject unknown accounts and invalid UUIDs through existing validation.

- [ ] **Step 5: Implement/test BFF and export button**

Forward only validated `accountId`, preserve content type/disposition, download the blob, disable while running, and expose success/failure via `role=status`.

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter api test -- src/notes && pnpm --filter api typecheck && pnpm --filter web test -- app/api/notes/export/route.spec.ts components/note-export.spec.tsx && pnpm --filter web typecheck`

```bash
git add apps/api/src/notes apps/api/src/main.ts apps/web/app/api/notes apps/web/components/note-export*
git commit -m "feat: export note data bundle"
git push origin HEAD:main
```

### Task 3: Build table/card note explorer

**Files:**
- Create: `apps/web/components/note-explorer.tsx`
- Create: `apps/web/components/note-explorer.spec.tsx`
- Modify: `apps/web/app/(dashboard)/notes/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- `NoteExplorer({ notes }: { notes: Note[] })` renders accessible buttons `表格视图` and `卡片视图`, persists key `xhs-note-view`, and shows views/likes/comments/favorites through availability-aware formatting.

- [ ] **Step 1: Write failing component tests**

Assert table is default, one row exposes all required columns, unknown is “尚未同步”, zero is `0`, card mode exposes the same metrics, and a remount reads the saved view.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter web test -- components/note-explorer.spec.tsx`
Expected: FAIL because component is missing.

- [ ] **Step 3: Implement explorer and page toolbar**

Add the switcher, account filter, and `NoteExport` to the heading. Use semantic table markup and accessible pressed states. Card source labels must say “账号自抓数据”, “官方 API”, or “演示数据” accurately.

- [ ] **Step 4: Add responsive styling**

Fix desktop table header, use compact numeric cells, and hide the table in favor of cards below 820px without page-level overflow.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter web test -- components/note-explorer.spec.tsx && pnpm --filter web typecheck`

```bash
git add apps/web/components/note-explorer* apps/web/app/'(dashboard)'/notes/page.tsx apps/web/app/globals.css
git commit -m "feat: make note data immediately visible"
git push origin HEAD:main
```

### Task 4: Auto-load and display every comment

**Files:**
- Create: `apps/web/app/api/comments/route.ts`
- Create: `apps/web/app/api/comments/route.spec.ts`
- Create: `apps/web/components/all-note-comments.tsx`
- Create: `apps/web/components/all-note-comments.spec.tsx`
- Modify: `apps/web/components/comment-tree.tsx`
- Modify: `apps/web/app/(dashboard)/notes/[id]/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- BFF: `GET /api/comments?noteId=<uuid>&cursor=<opaque>&limit=200`, allowing only those keys and forwarding authentication.
- `AllNoteComments` accepts `noteId`, initial page, completeness state, and automatically fetches until completion with repeated-cursor detection.

- [ ] **Step 1: Write failing BFF validation tests**

Assert valid bounded comment queries forward, unknown keys and invalid note IDs return 400, and authentication failures are preserved.

- [ ] **Step 2: Implement BFF route and verify**

Run: `pnpm --filter web test -- app/api/comments/route.spec.ts`
Expected before implementation: FAIL. After implementation: PASS.

- [ ] **Step 3: Write failing auto-pagination tests**

Mock two pages and assert all comments render without clicking; assert progress text while pending; assert repeated cursor stops with an incomplete warning; assert 0 comments with `page_complete` differs from missing/unverifiable completeness.

- [ ] **Step 4: Implement bounded auto-pagination and rendering**

Load pages of 200, stop at 1,000 pages/100,000 rows, retain already loaded comments on failure, and render in 200-comment chunks to bound DOM work. Add the existing per-note `CommentExport` button.

- [ ] **Step 5: Redesign detail metric and comment panels**

Replace the placeholder grid with four compact metric cards, render completeness-specific copy, and retain source/timestamp evidence.

- [ ] **Step 6: Verify complete feature**

Run serially:

```bash
pnpm --filter api test
pnpm --filter api test:e2e
pnpm --filter api typecheck
pnpm --filter web test
pnpm --filter web typecheck
zsh ops/macos/xhs-services.test.sh
git diff --check
```

- [ ] **Step 7: Install runtime revision and browser QA**

Run `zsh ops/macos/xhs-services.sh install '11111'`, then verify table/card switching, ZIP download, note-detail all-comment loading, desktop/mobile layouts, and zero browser console errors.

- [ ] **Step 8: Commit and push**

```bash
git add apps/web/app/api/comments apps/web/components/all-note-comments* apps/web/components/comment-tree.tsx apps/web/app/'(dashboard)'/notes/'[id]'/page.tsx apps/web/app/globals.css
git commit -m "feat: show every note comment"
git push origin HEAD:main
```
