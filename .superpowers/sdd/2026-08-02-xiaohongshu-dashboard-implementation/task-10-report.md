# Task 10 implementation report

## Delivered

- Added `/login`, `/accounts`, `/jobs`, `/notes`, `/notes/[id]`, and `/comments`.
- Added the mock authorization dialog, job progress, nested comment tree, and precise comment completeness components.
- Kept `mock`, `self_import` (`自有数据导入), and `official` sources separate. Official API is explicitly shown as unconfigured and no endpoint is invented.
- Wired account, job, note, comment, cursor pagination, and comment export reads to the existing API contract.
- Added explicit loading, authentication redirect, service error, empty, metric unavailable, page completeness, and filter-scope copy.
- Added responsive desktop/mobile layouts and semantic labels/dialog/status regions.

## TDD evidence

1. Added `comment-tree.spec.tsx` first.
2. Confirmed RED: `Cannot find module './comment-tree'`.
3. Implemented the minimum tree and completeness components.
4. Confirmed GREEN: 7 test files, 20 tests passed.

## Verification

- `pnpm --filter web test`: PASS (20/20)
- `pnpm --filter web typecheck`: PASS
- `pnpm --filter web build`: PASS
- In-app browser, desktop login at `http://127.0.0.1:3100/login`: correct title/identity, meaningful DOM, no framework overlay, no console warnings/errors.
- In-app browser, 390x844 mobile login: responsive card and controls fit without clipping; meaningful DOM; no console warnings/errors.

## Contract limitations kept honest

- The current notes API exposes list only, so note detail is resolved from the bounded list and metric values remain explicitly “待导入”; missing values are never rendered as zero.
- The comments API supports account/note/date server filters. Keyword and “new” filters are therefore explicitly labeled current-page filters.
- The jobs API exposes create and cancel but no retry endpoint. The UI does not invent a retry endpoint; controls requiring a CSRF-preserving mutation bridge remain non-destructive until that bridge is supplied.
- No JSON field-level mapping/import script was implemented; it awaits the first sample as required.

## Review round 1

- Login now keeps the upstream CSRF token in a production-secure, Strict, HttpOnly `web_csrf` cookie. The browser never receives the token or `API_BASE_URL`.
- Fixed allowlist BFF routes validate Origin and Fetch Metadata and forward session plus CSRF only server-side. Logout clears both cookies.
- Jobs now use real create/cancel API operations; retry creates a new job for the failed job's account and every operation exposes pending/success/error status.
- Account authorize/reauthorize/deactivate/delete operations are live through the guarded BFF. Mock authorization has its own real form; existing mock credentials can be replaced; deletion requires confirmation and explicit `retainData`. Self-import explains that JSON import creates the account without OAuth, while official authorization remains visibly unavailable but reserved.
- Added exact `GET /notes/:id`; latest non-superseded metric snapshots include availability, value, source, and observed time. The detail UI no longer searches a paginated list.
- Comment keyword and recent-new filters now run in the API and share one Prisma scope across list, CSV, and background export payloads.
- Comment export now streams through same-origin BFF, preserves CSV headers, and turns HTTP 202 into a visible background-job status/link.
- Added a shared dashboard-segment loading screen and keyboard-complete demo dialog behavior (Escape, focus trap, focus restoration, backdrop close).

### Round 1 evidence

- RED: missing BFF module and missing HttpOnly CSRF cookie helper; GREEN: boundary tests pass.
- RED: demo dialog did not close on Escape/restore focus; GREEN: interaction test passes.
- Web: 11 files, 25 tests passed; typecheck and production build passed.
- API: 11 files, 64 tests passed; typecheck and production build passed.
- Browser: desktop invalid-login mutation produced the actionable alert with no console errors; clean 390x844 reload rendered without clipping, overlays, warnings, or errors.

## Review round 2

- Login validates Origin and Fetch Metadata before reading the body or contacting upstream. Login JSON is type/size/field bounded, the API pre-auth CSRF exchange remains intact, and only one well-formed `admin_session` value is accepted and rebuilt as a fixed-lifetime Strict HttpOnly cookie.
- All mutation BFFs require JSON, reject declared or streamed bodies above 16 KiB, reject unknown fields, and validate route-specific UUID/string/boolean shapes.
- Latest note metrics are ordered by captured evidence time, observed time, and revision, and snapshots outside their metric-definition effective interval are excluded.
- Job cancellation is a transactional compare-and-set limited to pending/running; missing jobs return 404 and completed jobs return 409.
- Account actions fail closed by source: mock supports credential lifecycle, self-import is JSON-import managed, and unconfigured official accounts are read-only.
- Mutation clients share 401 redirect and 403 messaging behavior; job and mock account actions disable while pending and expose `aria-busy` status.
- The mock dialog renders through a body portal and temporarily makes background siblings inert/aria-hidden, restoring prior attributes and trigger focus on close.

### Round 2 evidence

- RED confirmed for cross-site login, unsafe upstream cookies, unbounded/wrong-type JSON, and unknown fields; all boundary tests are now green.
- Web: 11 files, 28 tests passed; typecheck and production build passed.
- API: 11 files, 64 tests passed; typecheck and production build passed.
- Browser: desktop login mutation error state and clean 390x844 page passed with meaningful DOM and no application console warnings/errors.
- The planned local real-XHS QR collector remains outside Task 10; self-import stays read-only until that separate work begins.
