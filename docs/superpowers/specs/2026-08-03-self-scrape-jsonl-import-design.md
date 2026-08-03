# Self-Scrape JSONL 离线导入设计

## 目标

接收根目录 `my_notes.jsonl` 或同格式文件，将用户自抓的笔记数据安全、幂等地导入现有 `Account`、`Note`、`MetricDefinition`、`MetricSnapshot` 和报告重建链路。保持 mock 不变，保留 future official connector。

## 固定来源

- 导入来源与 connectorType 固定为 `self-scrape`。
- 输入行的 `note.source` 和 `metrics.source` 必须都是 `self-scrape`。
- `mock`、`official`、`self_import` 或其他值均拒绝，不做隐式转换。

## 输入契约

每行是独立 JSON 对象：

- `note.platformId`: 非空、长度受限、同来源唯一。
- `note.accountId`: 可以为空；导入命令必须显式提供目标 `Account.platformId`。
- `note.title`: 字符串，长度受限。
- `note.publishedAt`: 带时区 ISO-8601。
- `metrics.noteId`: 必须等于 `note.platformId`。
- `metrics.capturedAt`: 带时区 ISO-8601。
- `metrics.views/likes/comments`: 非负安全整数。
- `views_available`: boolean；false 时 views 作为占位输入忽略。
- `extra.collected/shares`: 可选非负整数，第一阶段只进入导入审计摘要，不创建看板指标。

未知字段默认拒绝，避免抓取格式漂移被静默写入。

## 指标映射

建立或复用三条 `MetricDefinition`：

| key | displayName | aggregation | source | version |
|---|---|---|---|---|
| views | 阅读量 | cumulative_delta | self-scrape | jsonl-v1 |
| likes | 点赞 | cumulative_delta | self-scrape | jsonl-v1 |
| comments | 评论 | cumulative_delta | self-scrape | jsonl-v1 |

- 累计样本不伪造权威周期：`authoritativePeriod=false`，`windowStart/windowEnd=null`。
- likes/comments：0 对应 `availability=zero`；正数为 `available`。
- views_available=false：`availability=not_provided`、`value=null`，不得把占位 0 当成真实零。
- views_available=true 时按实际 views 写入 zero/available。
- `capturedAt` 和 `observedAt` 都使用样本的真实采集时间；无 rolling context。

## 账号与笔记

- 导入前按 `(connectorType='self-scrape', platformId=<显式参数>)` 查找或创建账号。
- self-scrape 账号不创建官方 credential，不进入 official scheduler。
- Note 按 `(connectorType='self-scrape', platformId)` upsert，并必须归属于目标账号；同平台 ID 已归属另一账号时拒绝。

## 幂等与修订

- 同一 note、definition、capturedAt、值和 availability 重复导入：no-op。
- 同一身份但值/availability 改变：复用现有 append-only correction revision，保留旧证据。
- 每个文件拥有导入运行 ID、文件 SHA-256、行数、成功/失败统计；同一文件重复导入可返回既有结果或安全重放。
- 一行包含 Note 与三项指标，行级事务保证不会只写一半。

## 报告与看板

- self-scrape 报告与 official/mock 分开，不跨 source 聚合。
- 成功新增或修订快照后，写 source=`self-scrape` 的 BackfillEvent；只触发 self-scrape 自己的 awaiting/complete 报告重建。
- 第一份累计样本没有基线时显示 `not_synced`；第二份及以后才能计算周期增量。

## 入口与安全

- 第一阶段提供本机 CLI/library 入口，不开放公网文件上传。
- 文件按流逐行读取，限制单行字节、总行数和总文件大小；错误报告包含行号但不回显整行敏感内容。
- 默认 dry-run；显式 `--commit` 才落库。
- WorkBuddy 可编写调用该 contract/library 的包装脚本；不得绕过库直接拼 SQL。

