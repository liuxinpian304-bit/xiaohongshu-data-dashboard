#!/bin/zsh
set -euo pipefail

readonly WEB_LABEL=com.xhs.dashboard.web
readonly API_LABEL=com.xhs.dashboard.api
readonly COLLECTOR_LABEL=com.xhs.dashboard.collector
readonly SERVICE_HOME=${XHS_SERVICE_HOME:-$HOME/Library/Application Support/xiaohongshu-dashboard}
readonly LAUNCH_AGENT_HOME=${XHS_LAUNCH_AGENT_HOME:-$HOME/Library/LaunchAgents}

show_paths() {
  print -- "service_home=$SERVICE_HOME"
  print -- "launch_agent_home=$LAUNCH_AGENT_HOME"
  print -- "web_label=$WEB_LABEL"
  print -- "api_label=$API_LABEL"
  print -- "collector_label=$COLLECTOR_LABEL"
}

case ${1:-} in
  paths) show_paths ;;
  *)
    print -u2 -- "usage: ${0:t} paths"
    exit 64
    ;;
esac
