# macOS 固定后台服务

使用 `xhs-services.sh` 管理数据驾驶舱网页、API 和小红书本地采集器。安装后，服务在当前用户登录 Mac 时自动启动，异常退出时由 `launchd` 自动恢复。

## 命令

```zsh
zsh ops/macos/xhs-services.sh install
zsh ops/macos/xhs-services.sh start
zsh ops/macos/xhs-services.sh stop
zsh ops/macos/xhs-services.sh restart
zsh ops/macos/xhs-services.sh status
zsh ops/macos/xhs-services.sh uninstall
```

首次安装会提示输入驾驶舱管理员密码。私有运行配置保存在 `~/Library/Application Support/xiaohongshu-dashboard/runtime.env`，权限为 `0600`；日志保存在同目录的 `logs` 文件夹。LaunchAgent 文件位于 `~/Library/LaunchAgents`，其中不保存密码或令牌。

本机网页地址为 `http://127.0.0.1:3000`。运行 `zsh ops/macos/xhs-services.sh status` 会额外显示当前 `lan_url`，同一局域网内的设备可使用该地址访问。只有 Web 的 `3000` 端口监听局域网；API 仍位于本机 `127.0.0.1:3001`，采集器仍仅监听 `127.0.0.1:43127`。

`uninstall` 只卸载后台服务，不删除 PostgreSQL 数据、Docker 数据卷、小红书扫码登录配置或业务数据。
