#!/bin/zsh
set -euo pipefail

readonly WEB_LABEL=com.xhs.dashboard.web
readonly API_LABEL=com.xhs.dashboard.api
readonly COLLECTOR_LABEL=com.xhs.dashboard.collector
readonly SERVICE_HOME=${XHS_SERVICE_HOME:-$HOME/Library/Application Support/xiaohongshu-dashboard}
readonly LAUNCH_AGENT_HOME=${XHS_LAUNCH_AGENT_HOME:-$HOME/Library/LaunchAgents}
readonly REPO_ROOT=${XHS_REPO_ROOT:-${0:A:h:h:h}}
readonly LOG_HOME=$SERVICE_HOME/logs
readonly RUNTIME_ENV=$SERVICE_HOME/runtime.env
readonly LAUNCHER=$SERVICE_HOME/bin/xhs-launch
readonly SERVICE_APP=$SERVICE_HOME/app
readonly NODE_FALLBACK=/Users/jixiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
readonly PNPM_FALLBACK=/Users/jixiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm

node_bin() {
  command -v node 2>/dev/null || print -- "$NODE_FALLBACK"
}

prepare_runtime() {
  [[ ${XHS_SKIP_RUNTIME_PREPARE:-0} == 1 ]] && return
  local revision pnpm=$PNPM_FALLBACK
  local node=$(node_bin)
  revision=$(git -C "$REPO_ROOT" rev-parse HEAD)
  if [[ -e $SERVICE_APP/.git ]]; then
    git -C "$SERVICE_APP" checkout --detach "$revision"
  else
    git -C "$REPO_ROOT" worktree add --detach "$SERVICE_APP" "$revision"
  fi
  [[ -x $pnpm ]] || { print -u2 -- "pnpm executable unavailable"; exit 69; }
  (cd "$SERVICE_APP" && PATH="${node:h}:$PATH" "$pnpm" install --frozen-lockfile --ignore-scripts)
}

show_paths() {
  print -- "service_home=$SERVICE_HOME"
  print -- "launch_agent_home=$LAUNCH_AGENT_HOME"
  print -- "web_label=$WEB_LABEL"
  print -- "api_label=$API_LABEL"
  print -- "collector_label=$COLLECTOR_LABEL"
}

write_plist() {
  local label=$1 service=$2
  local plist=$LAUNCH_AGENT_HOME/$label.plist
  cat >| "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$LAUNCHER</string><string>$service</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>LANG</key><string>en_US.UTF-8</string><key>LC_ALL</key><string>en_US.UTF-8</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOG_HOME/$service.log</string>
  <key>StandardErrorPath</key><string>$LOG_HOME/$service.error.log</string>
</dict>
</plist>
EOF
}

render() {
  local password=${1:-}
  [[ -n $password ]] || { print -u2 -- "administrator password is required"; exit 64; }
  local node=$(node_bin)
  [[ -x $node ]] || { print -u2 -- "node executable unavailable"; exit 69; }
  mkdir -p "$SERVICE_HOME" "$SERVICE_HOME/bin" "$LOG_HOME" "$LAUNCH_AGENT_HOME"
  chmod 700 "$SERVICE_HOME" "$LOG_HOME"
  prepare_runtime
  cp "$REPO_ROOT/ops/macos/xhs-services.sh" "$SERVICE_HOME/bin/xhs-services.sh"
  chmod 700 "$SERVICE_HOME/bin/xhs-services.sh"
  cat >| "$LAUNCHER" <<EOF
#!/bin/zsh
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
export XHS_REPO_ROOT=${(q)SERVICE_APP}
exec /bin/zsh ${(q)SERVICE_HOME}/bin/xhs-services.sh run "\$1"
EOF
  chmod 700 "$LAUNCHER"
  local hash credential_key collector_token
  hash=$(cd "$REPO_ROOT/apps/api" && ADMIN_PASSWORD_TEMP=$password "$node" -e 'require("argon2").hash(process.env.ADMIN_PASSWORD_TEMP,{type:require("argon2").argon2id}).then(v=>process.stdout.write(v))')
  credential_key=$($node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))')
  collector_token=$($node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
  umask 077
  {
    print -r -- "ADMIN_PASSWORD_HASH=${(q)hash}"
    print -r -- "CREDENTIAL_ENCRYPTION_KEY=${(q)credential_key}"
    print -r -- "LOCAL_XHS_COLLECTOR_TOKEN=${(q)collector_token}"
    print -r -- "DATABASE_URL=postgresql://xhs_runtime:local-dashboard-runtime-2026@127.0.0.1:55432/xhs_dashboard"
  } >| "$RUNTIME_ENV"
  chmod 600 "$RUNTIME_ENV"
  write_plist "$WEB_LABEL" web
  write_plist "$API_LABEL" api
  write_plist "$COLLECTOR_LABEL" collector
}

load_runtime() {
  [[ -f $RUNTIME_ENV ]] || { print -u2 -- "runtime configuration missing; run install"; exit 78; }
  [[ $(stat -f '%Lp' "$RUNTIME_ENV") == 600 ]] || { print -u2 -- "runtime configuration must use mode 600"; exit 78; }
  source "$RUNTIME_ENV"
  export ADMIN_PASSWORD_HASH CREDENTIAL_ENCRYPTION_KEY LOCAL_XHS_COLLECTOR_TOKEN DATABASE_URL
}

run_service() {
  local service=${1:-} node=$(node_bin)
  load_runtime
  export PATH="${node:h}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  case $service in
    web)
      export API_BASE_URL=http://127.0.0.1:3001 APP_ORIGIN=http://127.0.0.1:3000
      cd "$REPO_ROOT/apps/web"
      exec "$node" "$REPO_ROOT/apps/web/node_modules/next/dist/bin/next" dev --hostname 127.0.0.1
      ;;
    api)
      export API_PORT=3001 APP_ORIGIN=http://127.0.0.1:3000
      export LOCAL_XHS_COLLECTOR_ENABLED=true LOCAL_XHS_COLLECTOR_URL=http://127.0.0.1:43127
      cd "$REPO_ROOT/apps/api"
      exec "$node" "$REPO_ROOT/apps/api/node_modules/tsx/dist/cli.mjs" watch src/main.ts
      ;;
    collector)
      export LOCAL_XHS_COLLECTOR_ENABLED=true LOCAL_XHS_COLLECTOR_HOST=127.0.0.1 LOCAL_XHS_COLLECTOR_PORT=43127
      cd "$REPO_ROOT/apps/collector"
      exec "$node" "$REPO_ROOT/apps/collector/node_modules/tsx/dist/cli.mjs" watch src/server.ts
      ;;
    *) print -u2 -- "unknown service: $service"; exit 64 ;;
  esac
}

labels() {
  print -- "$WEB_LABEL"
  print -- "$API_LABEL"
  print -- "$COLLECTOR_LABEL"
}

start_dependencies() {
  command -v docker >/dev/null || { print -u2 -- "docker is unavailable"; exit 69; }
  docker start dashboard-mvp-postgres-1 dashboard-mvp-redis-1 >/dev/null
}

start_services() {
  start_dependencies
  local domain="gui/$(id -u)" label plist
  for label in ${(f)"$(labels)"}; do
    plist="$LAUNCH_AGENT_HOME/$label.plist"
    [[ -f $plist ]] || { print -u2 -- "missing $plist; run install"; exit 78; }
    launchctl bootstrap "$domain" "$plist" 2>/dev/null || true
    launchctl enable "$domain/$label"
    launchctl kickstart -k "$domain/$label"
  done
}

stop_services() {
  local domain="gui/$(id -u)" label
  for label in ${(f)"$(labels)"}; do
    launchctl bootout "$domain/$label" 2>/dev/null || true
  done
}

install_services() {
  local password=${ADMIN_PASSWORD:-${1:-}}
  [[ -n $password ]] || { print -u2 -- "set ADMIN_PASSWORD or pass the password to install"; exit 64; }
  render "$password"
  start_services
}

uninstall_services() {
  stop_services
  local label
  for label in ${(f)"$(labels)"}; do
    rm -f -- "$LAUNCH_AGENT_HOME/$label.plist"
  done
}

healthy_url() {
  curl -fsS -o /dev/null "$1"
}

show_status() {
  load_runtime
  local failed=0 state
  state=$(docker inspect --format '{{.State.Health.Status}}' dashboard-mvp-postgres-1 2>/dev/null || print unavailable)
  print -- "postgres=$state"
  [[ $state == healthy ]] || failed=1
  state=$(docker inspect --format '{{.State.Health.Status}}' dashboard-mvp-redis-1 2>/dev/null || print unavailable)
  print -- "redis=$state"
  [[ $state == healthy ]] || failed=1
  if healthy_url 'http://127.0.0.1:3000/dashboard?period=daily'; then print -- "web=healthy"; else print -- "web=unhealthy"; failed=1; fi
  if healthy_url http://127.0.0.1:3001/health; then print -- "api=healthy"; else print -- "api=unhealthy"; failed=1; fi
  if curl -fsS -o /dev/null -H "Authorization: Bearer $LOCAL_XHS_COLLECTOR_TOKEN" http://127.0.0.1:43127/v1/session/status; then print -- "collector=healthy"; else print -- "collector=unhealthy"; failed=1; fi
  return $failed
}

case ${1:-} in
  paths) show_paths ;;
  render) render "${2:-}" ;;
  run) run_service "${2:-}" ;;
  install) install_services "${2:-}" ;;
  start) start_services ;;
  stop) stop_services ;;
  restart) stop_services; start_services ;;
  status) show_status ;;
  uninstall) uninstall_services ;;
  *)
    print -u2 -- "usage: ${0:t} install|start|stop|restart|status|uninstall|paths"
    exit 64
    ;;
esac
