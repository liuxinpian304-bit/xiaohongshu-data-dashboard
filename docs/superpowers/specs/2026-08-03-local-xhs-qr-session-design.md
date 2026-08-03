# 本机小红书扫码会话设计

## 目标

在仅运行于用户 Mac 的驾驶舱中，提供“登录小红书”入口。点击后启动独立、可见、持久化的 Chromium 窗口，用户在小红书真实页面亲自扫码。登录会话只保存在本机，不作为官方 OAuth，不标记为 `official`。

## 数据源边界

- `mock`：演示数据，保持不变。
- `self_import`：本机扫码会话与用户自有采集数据。
- `official`：未来获批官方接口后接入，当前保留但不调用虚构接口。

## 组件

### Local Collector

- 新建独立本机进程，仅绑定 `127.0.0.1`。
- 使用 Playwright persistent context 启动 headed Chromium，导航至小红书公开网站登录页面。
- profile 保存到项目数据目录之外的本机私有目录，目录权限 `0700`、文件权限尽可能限制为当前用户。
- 不提供读取 Cookie、localStorage、浏览器配置或二维码图像的 HTTP 接口。
- 状态仅包含 `idle | launching | browser_open | user_confirmed | closed | error`、时间和脱敏错误码。
- “user_confirmed”表示用户确认已在真实浏览器完成扫码，不冒充官方 API 验证；首份可导出的自有数据将成为后续可用性验证。

### 驾驶舱集成

- 账号页对 `self_import` 显示“启动本机采集登录”。
- Web 通过现有安全 BFF 调用 API，API 再调用 loopback collector；浏览器不能直接访问 collector token。
- 所有写请求要求管理员 session、CSRF、Origin 和 Fetch Metadata。
- collector 使用启动时随机共享 token；token 只存在于本机进程环境或权限受限文件，不进入网页、日志和数据库。

## 安全约束

- 默认关闭；必须显式设置 `LOCAL_XHS_COLLECTOR_ENABLED=true`。
- 非 loopback 绑定、生产托管环境或缺少共享 token 时拒绝启动。
- 一次只允许一个持久浏览器会话；重复启动幂等返回当前状态。
- 关闭操作只关闭浏览器进程，不默认删除 profile；清除登录状态需要单独危险确认。
- 不绕过验证码、风控、设备验证或平台限制；出现验证页面由用户亲自处理。
- 不使用或假设未公开小红书 API endpoint。

## 第一阶段验收

- 驾驶舱点击按钮后，Mac 出现真实小红书 Chromium 窗口。
- 用户可亲自扫码并在该窗口中看到登录后的页面。
- 重启 collector 后可复用本机 profile；网页和 API 响应中没有 Cookie。
- 非本机、未授权、跨站、缺 CSRF、功能未启用请求全部拒绝。
- mock 与 official 路径不受影响。

## 后续采集

首份真实页面/JSONL 样本产生后，再由 WorkBuddy 编写字段级导出与导入映射。导入必须使用 `self_import`，累计 views/likes/comments 默认使用 `cumulative_delta`，不得伪造 `authoritativePeriod` 或窗口。

