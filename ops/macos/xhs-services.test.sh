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

$script render test-password

[[ -f $XHS_SERVICE_HOME/runtime.env ]] || fail "runtime env missing"
[[ $(stat -f '%Lp' $XHS_SERVICE_HOME/runtime.env) == 600 ]] || fail "runtime env must use mode 600"
for label in com.xhs.dashboard.web com.xhs.dashboard.api com.xhs.dashboard.collector; do
  plist="$XHS_LAUNCH_AGENT_HOME/$label.plist"
  [[ -f $plist ]] || fail "$label plist missing"
  plutil -lint "$plist" >/dev/null || fail "$label plist invalid"
  grep -q '<key>RunAtLoad</key>' "$plist" || fail "$label RunAtLoad missing"
  grep -q '<key>KeepAlive</key>' "$plist" || fail "$label KeepAlive missing"
  ! grep -q 'test-password' "$plist" || fail "$label leaks password"
done

print -- "PASS: secure service rendering"
