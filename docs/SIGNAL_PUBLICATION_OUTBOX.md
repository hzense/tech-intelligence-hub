# Signal 发表转换与 Outbox：私有事务底座

本批承接[版本封存](SIGNAL_VERSION_IMMUTABILITY.md)，实现发表／撤回的**私有状态转换存储**、永久请求回执、事务 Outbox 和纯投影规划。不是可以上线的 Publisher；没有新增公开视图、网站读取、生产入口或角色授权，也没有执行生产迁移。

> **后续交付：** 本批已由 PR #72 合并为 `6db71c6`，PR 与 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34760910939) 通过，184 项原生 PostgreSQL 集成通过；第 7 节保留提交前本地证据。后续 [任务与发布控制](SIGNAL_PUBLICATION_CONTROLS.md)实现第 6 节第 1 项的私有控制存储与锁定检查，但尚未与资格、新版本组装和本页转换写入合并为完整 Publisher。

> **最新增量（2026-09-13）：** `0009` 控制底座已合并；本地 `0010` [已记录资格检查与原子发表](SIGNAL_QUALIFIED_PUBLICATION.md)复用本页纯转换规划器，在一个自有事务中检查记录资格、克隆来源版本并写入 Outbox／head／运行绑定回执，不调用本页独立事务存储来拼接事务。第 6 节第 1、2、4 项的私有核心已有实现，完整事实核验、依赖失效协调、受限身份和公开消费者仍未完成。

## 1. 本批解决什么

- 当前状态与对应 Outbox 事件一起提交；缺事件、缺状态、错误配对和事务中途失败不能留下半成品。
- 同一请求只产生一次转换；同键不同内容拒绝。响应丢失后的重试返回原回执，不重复发表，也不把最新状态倒回旧状态。
- 内容版本与发布修订分离，支持撤回同一正文版本。旧事件不能重新激活已经撤回的正文。
- Outbox 是永久、仅追加的转换账本，同时承担请求回执；不因消费成功删除事件。未来消费进度／重试记录必须另表保存。

## 2. 两种版本号

| 操作                   | `content_version` | `publication_revision` | 当前状态  |
| ---------------------- | ----------------: | ---------------------: | --------- |
| 首次发表               |                 1 |                      1 | published |
| 撤回该正文             |                 1 |                      2 | withdrawn |
| 补证后以新正文重新发表 |                 2 |                      3 | published |

两个计数均为正 int32；请求 `expected_revision` 从 0 开始。达到 int32 上限时拒绝继续递增，不绕回、截断或用不精确数值计算。重新发表必须使用更高内容版本，不能直接重新公开已撤回版本。历史 Seed 的 `accepted` 不参与这里的公开状态转换。

## 3. 私有存储

追加 `0008_signal_publication_outbox.sql`，不改历史迁移：

- `signal_publication_outbox`：UUID 事件 ID、唯一请求键、请求 SHA-256、Signal ID、前置／新发布修订号、内容版本、目标状态、固定原因码和数据库生成的毫秒级时间。绑定已存在的 Signal 版本和规范事件身份。
- `signal_publication_state`：每个 Signal 的当前修订、内容版本、状态、事件 ID 和同一时间；完整复合外键锚定同一条 Outbox 事件。

两张表的 `occurred_at` 是**发表状态转换发生时间**，不是 Signal 中的事实事件时间。它由数据库时钟生成；不覆盖 `signals`／`signal_versions` 的事件时间，也不能用来给旧事件增加热榜新鲜度。

Outbox 不保存正文、摘要、URL、模型输出或任意撤回理由。原因码只允许：首次发表 `initial_publication`、更正 `content_correction`、重新发表 `republication`；撤回使用 `factual_error`、`privacy`、`evidence_revoked`、`operator_request`。需要详细审计理由时，后续使用单独授权的私有审计存储，不把私密材料塞进消息载荷。

Outbox 的 UPDATE／DELETE／TRUNCATE 被拒绝。延迟配对约束在提交前确认当前状态对应该 Signal 的最新事件；仅插入事件、仅写状态、指向旧事件或删除当前状态均不能单独提交。同一事务可以产生连续转换，以最终最新事件作为当前状态。应用 guard 的函数正文、属性、ACL 和触发器目录精确加入既有 verifier，不放开未知函数／触发器。

这些约束保护存储一致性，不验证新闻事实、人物是否合格、操作者是否授权或当前发布政策。可信 owner 的 DDL 仍是外部治理边界；不能用 owner 身份向生产绕过未完成的资格门禁。

## 4. 代码与事务

- [转换规划器](../packages/database/src/signal-publication-transition.mjs)：严格请求／状态／回执解析、规范指纹、转换前置条件及纯投影规划。
- [私有事务存储](../packages/database/src/signal-publication-store.mjs)：借用独立连接并拥有完整短事务，不接受调用者事务或任意回调。
- [迁移](../db/migrations/0008_signal_publication_outbox.sql)和 [ORM](../packages/database/src/schema.ts)：持久化契约；完整结构检查仍由独立 catalog 契约完成。
- [单元测试](../packages/database/test/signal-publication-store.test.mjs)与[原生集成](../packages/database/test/signal-publication.integration.test.mjs)：事务失败、重放、并发及目录保护。

存储顺序：解析请求 → `READ COMMITTED` 事务 → 请求键事务级 advisory lock → 稳定 Signal 行锁 → 当前 head／历史回执 → 纯转换规划 → 插入 Outbox → CAS 更新当前状态 → 提交。先锁父 Signal，覆盖首次发表时尚不存在 head 的竞争；相同请求键跨 Signal 也先串行检查。全部 SQL 值参数化，固定 `pg_catalog, pg_temp` 搜索路径，有界锁／语句／事务空闲等待。

锁和隔离语义依据 PostgreSQL 的[显式锁](https://www.postgresql.org/docs/current/explicit-locking.html)与[事务隔离](https://www.postgresql.org/docs/current/transaction-iso.html)契约。事务中不执行模型调用、HTTP 请求或缓存更新。

同键同请求返回历史回执，并明确当前状态未变；同键改 Signal、动作、版本、前置修订或原因码均冲突。请求指纹覆盖全部语义字段，键顺序不影响指纹。不把相同目标版本下的新请求自动解释成原请求重试。提交返回异常可能是结果未知：调用方应使用同一键与同一载荷重试，不自动生成新键；失败连接从池中销毁。

## 5. 投影语义与尚未接入的消费者

纯投影规划比较事件、权威当前 head 和消费者已处理的**发布修订号**。过期发表事件不能恢复已撤回内容；未来事件、同修订但载荷不一致等异常拒绝。事件只是引用，不能单凭旧消息正文直接展示。

这不是已经运行的搜索消费者。真实消费者还须在同一事务更新投影和 checkpoint，处理重试／租约／失效通知，并在读搜索／列表／聚合时重新核对当前公开资格。不能拿一次纯函数的结果或 Outbox 行存在宣称“搜索 ready”，也不能声称上线的 60 秒同步目标已经验收。

## 6. 生产接入前仍须实现

1. 持久化发布总开关、原始任务意图／当前策略、操作者授权、取消状态、有效租约与 fencing token；在发表事务内读取并锁定，不接受调用者传来的 `authorized: true` 等自报许可。
2. 当前证据／人物／组织／事件身份资格与固定依赖锁顺序；证据撤销、人物合并等经协调入口使受影响公开资格失效。旧快照 verified 不代表当前仍合格。
3. 受限 Publisher 身份、独立授权的安全撤回入口及审计。撤回不依赖暂停中的采集租约或预算；替代正文仍走正常发表门禁。
4. 将资格检查、必要的新版本组装、公开状态及 Outbox 放进同一事务。本批存储原语引用现有版本，未接入资格化的新版本组装服务，不能把两次独立事务拼成完整发布。
5. 当前有效公开视图、真实投影消费者与 checkpoint、缓存失效及搜索读取保护，最后再切换旧 Seed Reader。

现有 `hzense_runtime` 和 `hzense_signal_writer` 不增加新表或新函数权限；不新增 Publisher 角色配置，不从包根导出存储原语、不配置应用路由／CLI／定时任务。未来不能仅新增一个 GRANT 或环境开关就声称完成上述门禁。

## 7. 本批验证记录

2026-09-13 本地开发验证：

- 整仓 1259 项单元测试通过：数据库 845、内容 343、搜索 28、Web 43；相比上一批新增 114 项。构建、类型、lint、Prettier、62 篇内容、Taxonomy／Seed、5 个工作流校验通过。未变模块复用 Turbo 缓存。
- 新增原生集成 53 项：发表／事务／并发／SQL 边界 33 项，writer 与 Runtime 权限各 10 项。全部纳入 `test:migrations`；本机无专用隔离管理员连接，含原有测试共 184 项跳过，不计为通过，仍待提交后的 CI。
- 项目外 PGlite 0.5.8（PostgreSQL 18.3 wasm／vector 0.8.1）执行 9 份迁移，完整 collector 核验 26 表、5 函数／19 触发器，前后零差异。复用新原生测试中的 30 个单连接回调全部通过；明确不运行其中 3 个双后端竞争测试。
- 另补验 12 个非法 SQL 边界、2 个合法年份／int32 端点和 12 类目录篡改。放宽复合外键、请求唯一性、原因码、年份或精度规则，以及禁用／提前执行配对守卫、替换函数正文、给 PUBLIC 授权，均被拒绝或由精确 verifier 检出。
- 独立代码审视未发现本批阻塞问题；强调纯投影规划不替代将来消费者的事务／checkpoint 和公开读取资格保护。
- `0008` SHA-256：`a1117fda9894ba6590d66c25195af6c3db700c0a0653170fe975c8af4ad4a75a`；历史 `0000`–`0007` 及角色配置 SQL 未修改。临时验证依赖未加入项目或锁文件。

以上是提交前的本地工程证据，不是原生多连接／真实角色登录证明、PR CI、合并或生产验收。本批通过独立 PR 交付，CI／评审／合并结果另行确认；没有创建生产角色、运行生产迁移或切换网站。
