# Self-Scrape JSONL Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供可供 WorkBuddy 包装脚本调用的本机 JSONL 导入 contract/library，将 self-scrape 数据幂等写入看板。

**Architecture:** 独立 package 负责 schema validation、流式解析和规范化；Worker/Database adapter 负责账号、笔记、定义、不可变快照和 backfill outbox。CLI 默认 dry-run，显式 commit 才写入。

**Tech Stack:** TypeScript、Node streams、Prisma/PostgreSQL、Vitest。

## Global Constraints

- source 与 connectorType 固定为 `self-scrape`。
- mock 不变；official connector 保留；三类来源不得混算。
- views_available=false 必须存 `not_provided + null`，不得存真实 zero。
- 累计样本使用 cumulative_delta，不伪造 authoritative period/window。
- 所有修订 append-only，旧 evidence/report version 保留。

---

### Task 1: JSONL Contract、Validator 与 Dry Run

**Files:**
- Create: `packages/self-scrape-import/package.json`
- Create: `packages/self-scrape-import/src/schema.ts`
- Create: `packages/self-scrape-import/src/parser.ts`
- Create: `packages/self-scrape-import/src/parser.spec.ts`
- Create: `packages/self-scrape-import/src/index.ts`
- Create: `docs/contracts/my-notes-jsonl-v1.schema.json`

**Interfaces:**
- `parseSelfScrapeJsonl(stream, limits)` 返回异步规范化记录和行级错误。
- `normalizeSelfScrapeRecord(input)` 返回固定 Note + 三项 Metric 输入。

- [ ] 用文档示例写成功 RED 测试，并覆盖 noteId 不匹配、source 错误、ISO 时间、负数、unsafe integer、views unavailable、未知字段和字节上限。
- [ ] 实现严格 schema 与流式 parser，不使用整文件读取。
- [ ] 实现 dry-run 摘要：文件 hash、有效/无效行数、指标 availability 统计，不包含整行数据。
- [ ] 运行 package test/typecheck/build 并提交 `feat: define self-scrape import contract`。

### Task 2: Prisma Import Adapter、CLI 与报告事件

**Files:**
- Create: `apps/worker/src/import/self-scrape-import.service.ts`
- Create: `apps/worker/src/import/self-scrape-import.service.spec.ts`
- Create: `apps/worker/src/import/self-scrape-import.cli.ts`
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/src/report/report.scheduler.ts`

**Interfaces:**
- `importSelfScrapeFile({ file, accountPlatformId, commit })` 返回脱敏运行摘要。
- CLI: `pnpm --filter worker import:self-scrape --file <path> --account <platformId> [--commit]`。

- [ ] 写失败测试：账号映射、三 definition、Note upsert、views unavailable、同值 no-op、变化 revision、跨账号冲突、行级事务。
- [ ] 实现 definition effective interval 与 account/note adapter，复用现有 append-only snapshot correction。
- [ ] 写失败测试：source=self-scrape BackfillEvent 只重建 self-scrape 报告，不触发 official/mock。
- [ ] 实现 outbox 与审计摘要；重复文件安全重放。
- [ ] 验证 dry-run 零写入、commit 落库、错误行回滚策略和 CLI 参数。
- [ ] 运行全量测试、typecheck/build、迁移状态并提交 `feat: import self-scrape note snapshots`。

