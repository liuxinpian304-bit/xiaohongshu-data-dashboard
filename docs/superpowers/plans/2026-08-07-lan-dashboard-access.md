# 局域网访问驾驶舱实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只向局域网开放驾驶舱 Web 端口，同时让本机和当前私有 IPv4 地址都能安全登录与执行写操作。

**Architecture:** 在共享 domain 包中集中解析和校验允许来源，Web BFF 与 API 共用同一规则；macOS 固定服务脚本只将 Next.js 绑定到 `0.0.0.0`，其他服务继续绑定回环地址。脚本动态检测 RFC1918 地址，并在状态输出中给出可直接访问的 `lan_url`。

**Tech Stack:** TypeScript、Next.js 15、NestJS 11、zsh、launchd、Vitest、macOS 网络工具。

## Global Constraints

- 仅 Web `3000` 端口允许局域网连接。
- API `3001`、collector `43127`、PostgreSQL 和 Redis不得新增局域网监听。
- 允许来源必须是明确配置的 HTTP/HTTPS origin，不能信任任意 Host 头。
- 兼容旧 `APP_ORIGIN`，新配置使用逗号分隔的 `APP_ORIGINS`。
- 当前局域网地址为 `192.168.0.7`，但实现不得硬编码该地址。
- 每个完整代码步骤都提交并尝试推送 `origin/main`。

---

### Task 1: 建立共享允许来源策略

**Files:**
- Create: `packages/domain/src/allowed-origins.ts`
- Create: `packages/domain/src/allowed-origins.spec.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `allowedOrigins(environment?: Record<string,string|undefined>): ReadonlySet<string>`、`requireAllowedOrigin(origin, environment?): string`、`primaryAllowedOrigin(environment?): string`。
- Consumes: `APP_ORIGINS`、兼容回退 `APP_ORIGIN`，默认 `http://127.0.0.1:3000`。

- [ ] **Step 1: Write failing origin-policy tests**

```ts
expect([...allowedOrigins({ APP_ORIGINS: 'http://127.0.0.1:3000,http://192.168.0.7:3000' })])
  .toEqual(['http://127.0.0.1:3000', 'http://192.168.0.7:3000']);
expect(requireAllowedOrigin('http://192.168.0.7:3000', environment)).toBe('http://192.168.0.7:3000');
expect(() => requireAllowedOrigin('http://evil.test:3000', environment)).toThrow('origin rejected');
expect(() => allowedOrigins({ APP_ORIGINS: 'not-a-url' })).toThrow('invalid application origin');
```

Also prove deduplication, path/query/credential rejection, and `APP_ORIGIN` fallback.

- [ ] **Step 2: Run targeted domain test and verify RED**

Run `pnpm --filter @xhs/domain exec vitest run src/allowed-origins.spec.ts`.

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict origin parsing**

Normalize with `new URL`, require `http:` or `https:`, reject username, password, non-root path, query and fragment, and store `url.origin`. Empty entries are ignored; an empty final set falls back to `http://127.0.0.1:3000`.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @xhs/domain exec vitest run src/allowed-origins.spec.ts
pnpm --filter @xhs/domain typecheck
```

- [ ] **Step 5: Commit and push**

```bash
git add packages/domain
git commit -m "feat: add allowed origin policy"
git push origin HEAD:main
```

### Task 2: 在 Web 和 API 使用多来源校验

**Files:**
- Modify: `apps/web/lib/bff.ts`
- Modify: `apps/web/lib/bff.spec.ts`
- Modify: `apps/web/app/api/session/login/route.ts`
- Modify: `apps/api/src/auth/auth.guard.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.service.integration.spec.ts` or create focused unit tests that do not access the database.

**Interfaces:**
- Consumes: `requireAllowedOrigin()` and `primaryAllowedOrigin()` from `@xhs/domain`.
- Produces: BFF forwards the browser's already validated origin to API; API accepts every configured origin and rejects all others.

- [ ] **Step 1: Write failing Web and API origin tests**

Extend BFF tests so `validateMutationRequest` returns the validated LAN origin and rejects an unknown origin. Assert `mutationHeaders(session, csrf, validatedOrigin)` forwards that exact origin.

Add focused API tests for both `AuthController.requireSameOrigin` behavior through `csrf()` and `AuthGuard.canActivate()` using `APP_ORIGINS=http://127.0.0.1:3000,http://192.168.0.7:3000`; LAN origin passes, `http://192.168.0.8:3000` fails.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter web exec vitest run lib/bff.spec.ts
pnpm --filter api exec vitest run src/auth/auth.guard.spec.ts src/auth/auth.controller.spec.ts
```

Expected: LAN-origin cases FAIL under the current single-origin equality checks.

- [ ] **Step 3: Implement request-origin propagation**

Make `validateMutationRequest` return the validated origin. In `forwardMutation`, pass it to `mutationHeaders`. Login route uses the request origin for upstream CSRF/login headers after validation. Replace API string equality checks with `requireAllowedOrigin`.

- [ ] **Step 4: Run focused tests and typechecks**

```bash
pnpm --filter web exec vitest run lib/bff.spec.ts app/api/session/login/route.spec.ts
pnpm --filter api exec vitest run src/auth/auth.guard.spec.ts src/auth/auth.controller.spec.ts
pnpm --filter web typecheck
pnpm --filter api typecheck
```

- [ ] **Step 5: Commit and push**

```bash
git add apps/web apps/api
git commit -m "feat: allow configured dashboard origins"
git push origin HEAD:main
```

### Task 3: 让固定 Web 服务监听局域网

**Files:**
- Modify: `ops/macos/xhs-services.sh`
- Modify: `ops/macos/xhs-services.test.sh`
- Modify: `ops/macos/README.md`

**Interfaces:**
- Produces: `private_ipv4()`、`application_origins()`，运行时 `APP_ORIGINS`，Web `--hostname 0.0.0.0`，状态行 `lan_url=...`。
- Preserves: API/collector loopback配置和现有 install/start/status 命令。

- [ ] **Step 1: Extend shell contract tests**

为测试 stub 增加 `ipconfig`，返回 `192.168.0.7`。断言渲染后的服务脚本包含 Web `--hostname 0.0.0.0`、`APP_ORIGINS`、collector `127.0.0.1`，并断言 status 输出 `lan_url=http://192.168.0.7:3000`。加入无地址 stub，断言 `lan_url=unavailable`。

- [ ] **Step 2: Run shell test and verify RED**

Run `zsh ops/macos/xhs-services.test.sh`.

Expected: FAIL because Web remains loopback-only and status has no LAN URL.

- [ ] **Step 3: Implement RFC1918 address discovery**

依次检查活动接口，接受 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`，拒绝回环、链路本地和公网地址。Web 绑定 `0.0.0.0`；API/collector 不变。状态始终输出一条 `lan_url`。

- [ ] **Step 4: Run shell test and inspect generated runtime**

Run:

```bash
zsh ops/macos/xhs-services.test.sh
zsh -n ops/macos/xhs-services.sh
```

Expected: PASS and syntax check exits 0.

- [ ] **Step 5: Commit and push**

```bash
git add ops/macos
git commit -m "feat: expose dashboard web on lan"
git push origin HEAD:main
```

### Task 4: 部署并验证端口隔离

**Files:**
- No source files expected.

**Interfaces:**
- Consumes: `ops/macos/xhs-services.sh install '11111'`.
- Produces: local URL and LAN URL both healthy, internal services unreachable through LAN IP.

- [ ] **Step 1: Run safe regression suites**

Run domain/Web focused tests, API focused tests and all typechecks from Tasks 1-3. Do not invoke the repository's database integration suites against `xhs_dashboard`.

- [ ] **Step 2: Install persistent services**

Run:

```bash
zsh ops/macos/xhs-services.sh install '11111'
zsh ops/macos/xhs-services.sh status
```

Use condition-based health checks after launchd restart instead of treating the first startup second as a failure.

- [ ] **Step 3: Verify reachable and blocked ports**

Read the current `lan_url` from status. Assert local and LAN Web URLs return HTTP success. Assert TCP/HTTP attempts to LAN IP ports `3001` and `43127` fail. Confirm API and collector still succeed through `127.0.0.1`.

- [ ] **Step 4: Browser QA through LAN URL**

Open the exact `lan_url`, log in with the existing administrator password, verify account and dashboard pages, console health, no framework overlay, and a harmless navigation interaction. Capture desktop/mobile screenshot evidence where practical.

- [ ] **Step 5: Final Git and operational verification**

Verify service revision, `git status`, local commits, remote state when GitHub is reachable, and keep the existing unrelated dirty report untouched. Report the LAN URL and common blockers such as macOS firewall or Wi-Fi client isolation.
