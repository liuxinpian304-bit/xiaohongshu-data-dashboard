# macOS Persistent Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Xiaohongshu dashboard web, API, collector, PostgreSQL, and Redis available after terminals and Codex tasks close.

**Architecture:** Repository-owned shell scripts expose install/start/stop/restart/status commands while three user LaunchAgents supervise Web, API, and Collector independently. Secrets live in a mode-0600 file under the user's Application Support directory; generated plists and logs stay outside Git. Existing Docker Compose containers retain PostgreSQL and Redis with restart policies.

**Tech Stack:** macOS launchd/launchctl, POSIX-compatible zsh, Docker Compose, pnpm, Next.js, NestJS, Playwright collector.

## Global Constraints

- Collector binds only to `127.0.0.1:43127`.
- Web listens on `127.0.0.1:3000`; API listens on `127.0.0.1:3001`.
- Private configuration and logs never enter Git; private environment file permissions are `0600`.
- Existing dashboard behavior, report algorithms, database data, connector interfaces, and collector Chrome profile remain unchanged.
- Uninstalling services must not delete PostgreSQL volumes, business data, or the collector browser profile.
- Every coherent repository change is committed and pushed to Git.

---

### Task 1: Define and test the service command interface

**Files:**
- Create: `ops/macos/xhs-services.sh`
- Create: `ops/macos/xhs-services.test.sh`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: repository root, bundled or system `node`, bundled or system `pnpm`, Docker CLI, `launchctl`.
- Produces: `xhs-services.sh install|start|stop|restart|status|uninstall`; exit code `0` only when the requested operation succeeds.

- [ ] **Step 1: Write the failing contract test**

```zsh
#!/bin/zsh
set -euo pipefail
script=${0:A:h}/xhs-services.sh
[[ -x $script ]]
output=$($script paths)
[[ $output == *"com.xhs.dashboard.web"* ]]
[[ $output == *"com.xhs.dashboard.api"* ]]
[[ $output == *"com.xhs.dashboard.collector"* ]]
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `zsh ops/macos/xhs-services.test.sh`
Expected: FAIL because `xhs-services.sh` does not exist or is not executable.

- [ ] **Step 3: Implement path discovery and command dispatch**

Create an executable zsh script with `set -euo pipefail`, constants for the repository, `~/Library/Application Support/xiaohongshu-dashboard`, `~/Library/LaunchAgents`, and labels `com.xhs.dashboard.web`, `com.xhs.dashboard.api`, and `com.xhs.dashboard.collector`. Implement `paths` first and reject unknown commands with exit code 64. Resolve Node/pnpm from `command -v`, falling back to the Codex bundled runtime paths already used by this workspace.

- [ ] **Step 4: Add local runtime artifacts to `.gitignore`**

Add only repository-local generated artifacts if any are introduced; user-level private configuration and logs already live outside the repository and need no ignore rule.

- [ ] **Step 5: Run checks**

Run: `zsh -n ops/macos/xhs-services.sh ops/macos/xhs-services.test.sh && zsh ops/macos/xhs-services.test.sh && git diff --check`
Expected: all commands exit 0.

- [ ] **Step 6: Commit and push**

```bash
git add .gitignore ops/macos/xhs-services.sh ops/macos/xhs-services.test.sh
git commit -m "feat: define persistent service commands"
git push origin HEAD:main
```

### Task 2: Generate secure runtime configuration and LaunchAgents

**Files:**
- Modify: `ops/macos/xhs-services.sh`
- Modify: `ops/macos/xhs-services.test.sh`
- Create: `ops/macos/README.md`

**Interfaces:**
- Consumes: `ADMIN_PASSWORD` during first install, existing PostgreSQL `xhs_runtime` role, persistent collector profile directory.
- Produces: mode-0600 `runtime.env`; three generated plist files; mode-0700 application support and log directories.

- [ ] **Step 1: Extend the failing test**

Use a temporary `XHS_SERVICE_HOME` and `XHS_LAUNCH_AGENT_HOME`; invoke `render test-password`; assert `runtime.env` has mode `600`, the three plist files exist, each plist passes `plutil -lint`, no plist contains `test-password`, and each plist has `RunAtLoad` plus `KeepAlive`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `zsh ops/macos/xhs-services.test.sh`
Expected: FAIL because `render` is not implemented.

- [ ] **Step 3: Implement secure render**

Generate the Argon2 administrator hash through the workspace's installed `argon2` package, generate random credential and collector secrets through Node crypto, write `runtime.env` with `umask 077`, and render plists that call `xhs-services.sh run web|api|collector`. Plists contain only paths and service names; the run command reads secrets from `runtime.env` without printing them.

- [ ] **Step 4: Document operations**

Document installation, commands, URLs, log paths, password reset, and uninstall behavior in `ops/macos/README.md`. State explicitly that uninstall preserves data and the collector profile.

- [ ] **Step 5: Run checks**

Run: `zsh -n ops/macos/xhs-services.sh ops/macos/xhs-services.test.sh && zsh ops/macos/xhs-services.test.sh && git diff --check`
Expected: tests pass, plist lint passes, no secret appears in generated plist fixtures.

- [ ] **Step 6: Commit and push**

```bash
git add ops/macos
git commit -m "feat: generate secure macos service config"
git push origin HEAD:main
```

### Task 3: Implement lifecycle and health commands

**Files:**
- Modify: `ops/macos/xhs-services.sh`
- Modify: `ops/macos/xhs-services.test.sh`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: rendered configuration, Docker Compose project, three plist labels.
- Produces: idempotent install/start/stop/restart/status/uninstall behavior and machine-readable health lines for postgres, redis, web, api, and collector.

- [ ] **Step 1: Add failing lifecycle tests with command stubs**

Place stub `docker`, `launchctl`, and `curl` executables first on `PATH`. Record invocations and assert: `start` invokes `docker compose up -d postgres redis` then bootstraps/kickstarts all three labels; `status` fails when a required check fails; `uninstall` bootouts labels and leaves service data directories intact.

- [ ] **Step 2: Run the test and verify it fails**

Run: `zsh ops/macos/xhs-services.test.sh`
Expected: FAIL because lifecycle commands are not implemented.

- [ ] **Step 3: Implement lifecycle behavior**

Use `launchctl bootstrap gui/$(id -u)`, `bootout`, `enable`, and `kickstart -k` idempotently. Before install/start, reject unknown listeners on ports 3000, 3001, and 43127. Start existing Compose dependencies without recreating data. `status` checks Docker health, `GET /health`, the Web dashboard response, and authenticated Collector status while redacting its token.

- [ ] **Step 4: Add Docker restart policies**

Set `restart: unless-stopped` for the repository's PostgreSQL and Redis services only. Do not modify volumes, ports, users, or health checks.

- [ ] **Step 5: Run checks**

Run: `zsh ops/macos/xhs-services.test.sh && docker compose config --quiet && git diff --check`
Expected: tests pass and Compose configuration validates.

- [ ] **Step 6: Commit and push**

```bash
git add ops/macos docker-compose.yml
git commit -m "feat: manage dashboard service lifecycle"
git push origin HEAD:main
```

### Task 4: Install and verify persistence on this Mac

**Files:**
- Modify: `ops/macos/README.md` only if verification exposes a documented operational gap.
- Create outside Git: `~/Library/Application Support/xiaohongshu-dashboard/runtime.env`
- Create outside Git: `~/Library/LaunchAgents/com.xhs.dashboard.{web,api,collector}.plist`

**Interfaces:**
- Consumes: `ops/macos/xhs-services.sh`, current administrator password, existing Docker containers and database.
- Produces: live persistent services reachable on ports 3000, 3001, and 43127.

- [ ] **Step 1: Stop temporary task-owned application processes**

Resolve exact listeners for ports 3000, 3001, and 43127. Stop only the known temporary Web/API/Collector processes; do not kill unrelated processes or containers.

- [ ] **Step 2: Install fixed services**

Run: `ADMIN_PASSWORD='current-user-confirmed-password' zsh ops/macos/xhs-services.sh install`
Expected: configuration and plists are created with restricted permissions and all labels bootstrap successfully.

- [ ] **Step 3: Verify all health checks**

Run: `zsh ops/macos/xhs-services.sh status`
Expected: postgres, redis, web, api, and collector all report healthy; Collector may report `idle` when it is ready but not actively collecting.

- [ ] **Step 4: Verify automatic recovery**

Capture the supervised Web PID from `launchctl print`, send that exact process `SIGTERM`, wait for `launchd` to assign a different PID, then verify `http://127.0.0.1:3000/dashboard?period=daily` returns successfully. Repeat for API and Collector without terminating containers.

- [ ] **Step 5: Verify browser behavior**

Open the dashboard and accounts pages, confirm the daily dashboard renders real account data, confirm the accounts page can reach Collector status, and check browser console errors. Keep the working dashboard tab available to the user.

- [ ] **Step 6: Run final repository verification**

Run: `zsh ops/macos/xhs-services.test.sh && docker compose config --quiet && pnpm --filter api typecheck && pnpm --filter web typecheck && git diff --check`
Expected: all commands exit 0.

- [ ] **Step 7: Commit any documentation correction and push**

If no documentation change was needed, create no empty commit. If a correction was needed:

```bash
git add ops/macos/README.md
git commit -m "docs: clarify persistent service operations"
git push origin HEAD:main
```
