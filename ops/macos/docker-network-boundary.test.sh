#!/bin/zsh
set -euo pipefail

repo_root=${0:A:h:h:h}
rendered=$(cd "$repo_root" && POSTGRES_PASSWORD=test XHS_RUNTIME_PASSWORD=test docker compose config)
loopback_bindings=$(print -r -- "$rendered" | grep -c 'host_ip: 127.0.0.1' || true)

if (( loopback_bindings != 2 )); then
  print -u2 -- "FAIL: expected PostgreSQL and Redis to bind only to 127.0.0.1"
  exit 1
fi

print -- 'PASS: Docker data services are loopback-only'
