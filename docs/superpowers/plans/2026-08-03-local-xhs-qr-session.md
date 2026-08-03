# Local XHS QR Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从驾驶舱安全启动本机真实小红书浏览器扫码会话，并持久化只属于本机用户的登录 profile。

**Architecture:** 新建 loopback-only collector 进程负责 Playwright persistent Chromium；API 使用随机共享 token 调用 collector；Web 通过现有管理员 BFF 操作 API。三层均 fail closed，网页永不接触小红书 Cookie。

**Tech Stack:** TypeScript、Playwright、NestJS、Next.js、Vitest。

## Global Constraints

- 只在本机 Mac 运行，collector 必须绑定 `127.0.0.1`。
- 数据源固定为 `self_import`，不得标成 `official`。
- 不调用未公开小红书 API，不绕过验证码或风控。
- Cookie、localStorage、profile 内容不得进入网页响应、应用日志或数据库。
- mock 和未来 official connector 保持不变。

---

### Task 1: Loopback Collector 与持久浏览器会话

**Files:**
- Create: `apps/collector/package.json`
- Create: `apps/collector/src/server.ts`
- Create: `apps/collector/src/session-manager.ts`
- Create: `apps/collector/src/session-manager.spec.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `.env.example`

**Interfaces:**
- `POST /v1/session/start` → 脱敏状态。
- `GET /v1/session/status` → 脱敏状态。
- `POST /v1/session/confirm` → 标记用户已完成浏览器扫码。
- `POST /v1/session/close` → 关闭 Chromium，保留 profile。

- [ ] 写失败测试：仅 loopback、Bearer token、单会话幂等、profile 权限、响应无 Cookie。
- [ ] 运行测试确认 RED。
- [ ] 实现 Playwright persistent context 和状态机；启动 headed Chromium 到小红书公开站点。
- [ ] 测试缺浏览器、启动失败、重复启动、关闭和进程退出清理。
- [ ] 运行 collector test/typecheck/build 并提交 `feat: add local xhs browser session`。

### Task 2: API、BFF 与账号页真实登录入口

**Files:**
- Create: `apps/api/src/local-collector/local-collector.module.ts`
- Create: `apps/api/src/local-collector/local-collector.controller.ts`
- Create: `apps/api/src/local-collector/local-collector.service.ts`
- Create: `apps/web/app/api/control/local-collector/[action]/route.ts`
- Create: `apps/web/components/self-import-login.tsx`
- Modify: `apps/web/app/(dashboard)/accounts/page.tsx`

**Interfaces:**
- API 只返回 collector 脱敏状态，要求管理员 session/CSRF/Origin/Fetch Metadata。
- BFF 复用严格 JSON body 上限与同源保护。

- [ ] 写失败测试：功能关闭、非 loopback URL、collector token 缺失、超时、401/403、跨站请求。
- [ ] 实现 API loopback client、allowlist action 和超时/错误映射。
- [ ] 实现账号页启动、确认、关闭和状态轮询；pending 时禁用重复操作。
- [ ] 浏览器检查桌面/移动端、键盘操作、collector 不可用状态。
- [ ] 运行 API/Web/Collector 全量测试、typecheck/build 并提交 `feat: launch self-import qr sessions`。

