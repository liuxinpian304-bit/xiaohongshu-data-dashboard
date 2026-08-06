#!/bin/zsh
set -euo pipefail

script=${0:A:h}/xhs-services.sh

fail() {
  print -u2 -- "FAIL: $1"
  exit 1
}

[[ -x $script ]] || fail "service script must be executable"

paths_output=$($script paths)
[[ $paths_output == *"com.xhs.dashboard.web"* ]] || fail "web label missing"
[[ $paths_output == *"com.xhs.dashboard.api"* ]] || fail "api label missing"
[[ $paths_output == *"com.xhs.dashboard.collector"* ]] || fail "collector label missing"

print -- "PASS: service command contract"

temp_root=$(mktemp -d)
export XHS_SERVICE_HOME="$temp_root/service"
export XHS_LAUNCH_AGENT_HOME="$temp_root/agents"
export XHS_SKIP_RUNTIME_PREPARE=1

$script render test-password

[[ -f $XHS_SERVICE_HOME/runtime.env ]] || fail "runtime env missing"
[[ -x $XHS_SERVICE_HOME/bin/xhs-launch ]] || fail "ASCII launcher missing"
[[ -x $XHS_SERVICE_HOME/bin/xhs-services.sh ]] || fail "ASCII service runner missing"
grep -q "XHS_REPO_ROOT=$XHS_SERVICE_HOME/app" "$XHS_SERVICE_HOME/bin/xhs-launch" || fail "launcher must use ASCII runtime worktree"
grep -q 'node_modules/next/dist/bin/next' "$XHS_SERVICE_HOME/bin/xhs-services.sh" || fail "web must start Next directly"
grep -q 'node_modules/tsx/dist/cli.mjs' "$XHS_SERVICE_HOME/bin/xhs-services.sh" || fail "services must start tsx directly"
[[ $(stat -f '%Lp' $XHS_SERVICE_HOME/runtime.env) == 600 ]] || fail "runtime env must use mode 600"
for label in com.xhs.dashboard.web com.xhs.dashboard.api com.xhs.dashboard.collector; do
  plist="$XHS_LAUNCH_AGENT_HOME/$label.plist"
  [[ -f $plist ]] || fail "$label plist missing"
  plutil -lint "$plist" >/dev/null || fail "$label plist invalid"
  grep -q '<key>RunAtLoad</key>' "$plist" || fail "$label RunAtLoad missing"
  grep -q '<key>KeepAlive</key>' "$plist" || fail "$label KeepAlive missing"
  grep -q '<key>LANG</key><string>en_US.UTF-8</string>' "$plist" || fail "$label UTF-8 locale missing"
  ! grep -q 'test-password' "$plist" || fail "$label leaks password"
  LC_ALL=C grep -q '[^ -~]' "$plist" && fail "$label plist must contain ASCII paths only"
  grep -q "$XHS_SERVICE_HOME/bin/xhs-launch" "$plist" || fail "$label must use ASCII launcher"
done

print -- "PASS: secure service rendering"

stub_dir="$temp_root/stubs"
mkdir -p "$stub_dir"
cat > "$stub_dir/docker" <<'EOF'
#!/bin/zsh
[[ $1 == inspect ]] && { print healthy; exit 0; }
exit 0
EOF
cat > "$stub_dir/curl" <<'EOF'
#!/bin/zsh
exit 0
EOF
cat > "$stub_dir/launchctl" <<'EOF'
#!/bin/zsh
print -- "$*" >> "$XHS_LAUNCHCTL_LOG"
exit 0
EOF
chmod +x "$stub_dir/docker" "$stub_dir/curl" "$stub_dir/launchctl"

status_output=$(PATH="$stub_dir:$PATH" $script status)
[[ $status_output == *"postgres=healthy"* ]] || fail "postgres health missing"
[[ $status_output == *"redis=healthy"* ]] || fail "redis health missing"
[[ $status_output == *"web=healthy"* ]] || fail "web health missing"
[[ $status_output == *"api=healthy"* ]] || fail "api health missing"
[[ $status_output == *"collector=healthy"* ]] || fail "collector health missing"

print -- "PASS: service health contract"

export XHS_LAUNCHCTL_LOG="$temp_root/launchctl.log"
PATH="$stub_dir:$PATH" $script start
for label in com.xhs.dashboard.web com.xhs.dashboard.api com.xhs.dashboard.collector; do
  grep -q "gui/$(id -u)/$label" "$XHS_LAUNCHCTL_LOG" || fail "$label was not started independently"
done

print -- "PASS: independent service lifecycle"
