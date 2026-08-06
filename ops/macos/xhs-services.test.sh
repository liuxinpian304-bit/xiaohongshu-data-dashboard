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
