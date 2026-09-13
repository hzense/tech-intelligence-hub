# Signal 已记录资格检查与原子发表：私有事务核心

承接已合并的 [任务与发布控制](SIGNAL_PUBLICATION_CONTROLS.md)，本批把数据库中已封存候选的已记录资格检查、新快照组装、当前发布状态、Outbox 和运行绑定回执放进同一个事务。**这是私有受信任接口，不是可上线的完整 Publisher。** 未新增认证、生产权限、公开读取、AI 调用或生产迁移。

设计取舍、反面观点与来源见[设计记录](../insights/2026-09-13-qualified-publication/README.md)。本批不将 `pending` 候选自动升级成 `verified`，也不把数据库状态检查等同于新闻事实核验。

## 1. 输入、输出与版本语义

私有入口位于 [signal-qualified-publication-store.mjs](../packages/database/src/signal-qualified-publication-store.mjs)：

```js
publishPrivateQualifiedSignalVersion({
  pool,
  request: {
    request_key,
    signal_id,
    source_version,
    target_version,
    expected_revision,
    reason_code,
    run_id,
    lease_owner,
    fencing_token,
  },
});
```

所有字段严格解析，不接受正文、任意 SQL、回调、`authorized` 或 `verified` 自报标记。此处 `source_version` 指候选内容版本，不是 `sources` 表的版本。连接池必须提供独立连接，不能以已有事务伪装成 Pool。

- 来源版本必须在此前事务中提交封存；目标版本必须大于来源版本及该 Signal 已存在的全部版本。
- 从来源版本复制完整 `3.0.0` 快照与证据／人物／组织／Topic 四类边，仅改变版本及其规范内容哈希，不刷新事件时间、采集时间、旧状态、摘要或分析。数据库 `created_xid` 是新事务的元数据，不进入内容哈希。
- 因此首次发表可能是“候选内容 v1 → 发表内容 v2，发布修订 r1”；发布修订不是内容版本号。
- 原子成功返回 `scope: private_recorded_qualification`、`outcome: apply`、head、事件 ID、来源版本、请求键与新哈希；它不代表可供公开 Reader 使用的授权票据。

原因码继续使用 `0008` 的首次发表／更正／重新发表规则。`expected_revision` 以 CAS 保护当前 head；达到 int32 上限时拒绝，不绕回。

## 2. 已记录资格检查

[纯规则模块](../packages/database/src/signal-publication-qualification.mjs)核对锁定投影中的当前记录：

- 来源快照满足完整 `3.0.0` 字段、日期与哈希契约。SQL 在 pg 驱动解码日期前检查有限值、UTC 年份 1–9999 及毫秒精度，防止微秒被截断后误认哈希有效；跨包测试与实际 content Schema／哈希实现互验。
- 至少一条已核验的支持证据、一个有支持证据的已核验 Person、一个当前启用且未归档的 Topic。所有被复制的人物与组织边都必须已核验，且引用同版本支持证据；不跳过不合格边后悄悄发表剩余部分。
- 支持／背景（supports/context）Evidence 必须当前为 `verified`，其 Source 启用且原文使用无凭据 HTTPS URL，并满足精确 host allowlist；主域名不自动授权其子域。已 `rejected` 的反证可保留为历史，不视为支持，也不要求其 Source 仍启用；未拒绝的反证仍按下述规则阻断。
- Person／Organization 的 Entity 类型、active 状态和类型化档案匹配；组织仅取显式事件边，不从任职或当前雇主推断。组织边允许为空，不放宽至少一人的要求。
- 显式记者／报道者角色被排除；字符串排除本身不能证明人物确为业内参与者。
- 规范事件身份必须绑定不晚于来源版本的、已核验的支持锚点；该锚点也必须保留在来源版本中。来源版本及身份依据版本中未被拒绝的反证均阻断，不能只检查最新候选而忽略旧身份反证。
- 缺记录、重复或无关投影、未知字段、异常对象和超限依赖均拒绝；每个投影集合最多 256 条。

**仍未证明的内容：** 原文事实真伪、全部断言覆盖、来源独立性、人物消歧、私有材料可公开性，以及提交后依赖仍长期有效。`verified` 在本批只是受信任核验记录，不是本服务重新阅读原文的结论。人物／组织边已封存，本批不能原地把旧 writer 的 `pending` 改为已核验；受控核验产物与新候选组装仍是下一项工作。

## 3. 同事务与锁序

```text
请求键 advisory lock → 历史回执检查
  → 全局开关 → 任务 → 授权 → run
  → Signal → 当前 head → 来源版本 → 事件身份
  → Source → Evidence → Entity → 人物/组织档案 → Topic
  → 资格检查 → 再检查租约
  → 新版本/四类边 → Outbox/head/绑定回执
  → SET CONSTRAINTS ALL IMMEDIATE → 最终门禁检查 → COMMIT
```

事务使用 `READ COMMITTED`。控制父记录及资格依赖使用 `FOR SHARE`，run／Signal／已有 head 使用 `FOR UPDATE`；每张依赖表按主键 C 顺序锁定。已封存的版本边和 Evidence 的来源归属不可变，路由查询不复用未锁定的核验状态。未来协调撤销入口须服从相同锁序。

若撤销先提交，等待的检查读取新状态并拒绝；若发表先持锁，撤销等待该短事务完成，不抢占已持锁的事务。该行为依据 PostgreSQL [行锁](https://www.postgresql.org/docs/18/explicit-locking.html)与 [READ COMMITTED](https://www.postgresql.org/docs/18/transaction-iso.html)语义。

数据库时钟在等待后读取。强制执行[延迟约束](https://www.postgresql.org/docs/18/sql-set-constraints.html)后再次检查控制与租约，之后立即提交；不承诺磁盘提交耗时也在租约截止之前。使用有界锁／语句／事务空闲超时，不跨网络、模型调用或缓存写入。

任何检查或写入失败都回滚，不能残留新版本、边、head 或回执；连接失败时从池中销毁。无法确认 COMMIT 结果时必须使用同一个请求键和语义载荷重试，不能自动换键补发。

## 4. 永久绑定回执与重试

`0010_qualified_signal_publication.sql` 新增私有 `signal_qualified_publication_receipts`，字段为：

| 字段                                              | 语义                         |
| ------------------------------------------------- | ---------------------------- |
| `request_key` / `request_fingerprint`             | 唯一请求键、资格入口语义指纹 |
| `signal_id` / `source_version` / `target_version` | 同一 Signal 的来源与目标版本 |
| `run_id` / `lease_owner` / `fencing_token`        | 实际提交时的运行及执行世代   |

复合外键将 `(request_key, signal_id, target_version)` 精确绑定到 Outbox，另绑定真实来源版本和 run。语义指纹包含 run、来源／目标、Signal、前置修订和原因码，但不含 owner／token：同一运行的合法租约接管仍可重试原操作，实际首次提交世代保存在回执中。

三个 ALWAYS 触发器及独立 INVOKER 守卫拒绝改写、删除、TRUNCATE；要求来源版本来自已提交事务、目标版本创建于当前事务，并延迟复核持久化发布控制、原始意图和保存的 run／owner／token。SQL 守卫维护绑定及控制一致性，不代替应用的完整记录资格检查；可信 owner DDL／任意 SQL 仍属于外部管理边界。

同键同语义已有绑定时返回 `private_historical_receipt`／`replay`，不再次组装或更改 head，即使运行随后取消、开关关闭、租约过期或正文已撤回。该返回仅回答“此前是否提交”，不能证明现在有执行权或可公开。更改 run／版本等语义字段拒绝；旧 `0008` Outbox 同键但没有此绑定也拒绝，不追认成资格发表。

历史回执不替代运行完成回执；本接口不会自动把 run 标为 completed。后台将来需明确处理部分完成、恢复与取消。

## 5. Schema、权限与后续接入

追加迁移后仓库目标为 **11 个迁移、31 张表（30 ORM + 1 迁移账本）、7 个函数、24 个 ALWAYS 触发器**；精确 catalog 与 Schema／Runtime／Topic 预检同步更新。`0000`–`0009`、旧角色授权 SQL、包依赖与锁文件保持不变。新回执和函数不向 `hzense_runtime`／`hzense_signal_writer` 授权，不从包根导出、不配置生产 CLI／路由／调度器。

后续必须完成受控核验产物、认证及受限 Publisher 身份、独立授权安全撤回、依赖失效协调、当前有效公开视图、投影消费者／checkpoint 和读切换。提交后 Source 或 Evidence 失效不会由本批自动撤回 head，因此不能据此开放新版网站读取或搜索。

`0010` 会给 Outbox 增加复合唯一索引及回执外键；生产执行前仍需评估既有数据、DDL 锁及维护契约，并单独审批。本轮只有隔离测试，不连接 Neon、不开云资源，也不更改生产自动发布开关。

## 6. 验证与交付状态

2026-09-13 本地验证：

- 整仓构建、类型检查、lint 和 **1624 项单元测试**通过：database 1181、content 372、search 28、web 43。新增纯资格规则 131 项、实际 content Schema／哈希兼容 29 项及事务入口单元 22 项均通过；其他新增用例校验 Schema／目录防弱化。普通单元命令中跳过的原生测试另行运行，不计作单元通过。
- 专用临时 PostgreSQL 18.4 / pgvector 0.8.6 的完整 `test:migrations` **318 项通过**：迁移／事务 157、Topic 角色 5、Runtime 角色 50、ACL 恢复 14、Signal writer 角色 92。仅使用合成凭据和测试数据，不连接 Neon。
- 新事务集成套件 46 项通过，包含 12 个直接观察锁等待的依赖竞争／租约过期场景，另覆盖同键及同 Signal 竞争、执行令牌接管、撤回后历史重放、完整边／哈希克隆及失败回滚。Runtime／writer 各增加 6 项拒绝访问检查。
- 新回执外键使旧控制测试的 TRUNCATE 在触发器前被 PostgreSQL 拒绝；测试改为显式同时列出关联表，继续断言原有 ALWAYS 守卫，未放宽拒绝规则或修改历史迁移。
- 独立只读代码审查未发现私有边界内的阻断问题；11 迁移、31 表及精确函数／触发器目录核验通过。资格与长期公开许可的差异、历史重放和 COMMIT 物理时刻限制保留为明确边界。
- 最终 Turbo 16 项任务全部成功，未改动部分复用 12 项缓存；整仓 Prettier、62 篇内容及交叉引用、Taxonomy／Seed、5 个工作流与 `git diff --check` 通过。历史迁移 `0000`–`0009`、角色授权 SQL 和依赖锁文件未改动。测试数据库／角色已清理，临时 PostgreSQL 实例已停止，未删除仓库材料。

原生测试命令仅用于真正可销毁的专用集群：`pnpm --filter @hzense/database test:migrations`，必须配置 `MIGRATION_TEST_ADMIN_URL` 及 `RUNTIME_READER_TEST_ISOLATED_CLUSTER=1`；仓库不保存其值，不以此验证生产数据库。

本批分支 `feat/qualified-signal-publication`，基于已合并 PR #73 的 `main@f0fc283`；基线 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34763140875) 成功。以上是提交前本地证据，本批通过独立 PR 交付；PR CI／评审／合并／生产执行须分别确认，不能以本地验证代替。

### PR #74 合并后 CI 清理竞态（2026-09-13）

[PR #74](https://github.com/hzense/tech-intelligence-hub/pull/74) 的 CI 通过，已合并为 `618c178`；随后 [main CI 的数据库任务](https://github.com/hzense/tech-intelligence-hub/actions/runs/34765438872/job/103745455338)失败。该任务首组 157 项断言全部通过，但 Vitest 捕获未处理的 `57P01: terminating connection due to administrator command`；错误来自控制套件的关闭中 Pool 客户端，而非业务断言。其余 foundation 与 Daily 门禁成功；后续角色测试因首组退出失败未运行，不能将本次 main CI 计作完整 318 项通过。

根因是测试清理竞争：锁定版本 `pg-pool@3.14.0` 在客户端从内部列表移除后即可兑现 `pool.end()`，实际异步断连尚未结束；紧接着调用 `pg_terminate_backend`，可能让关闭中的空闲客户端收到 FATAL，再通过 Pool error 成为未捕获异常。官方 [Pool 事件说明](https://node-postgres.com/apis/pool#events)解释了空闲客户端断连错误会传播到 Pool；具体先后顺序由锁定版本源码和回归验证，而非假设文档承诺了服务端会话已退出。

修复仅限测试基础设施：三个 Pool 套件在关闭连接池后，使用独立管理员连接以 autocommit 有界查询对应临时数据库的 `pg_stat_activity`，确认零连接才正常 DROP；移除强制终止，不吞错误、不忽略 Vitest 未捕获异常、不修改迁移或发布权限。若连接始终未退出，明确失败，保留现场而不是强杀。新增测试覆盖延迟断连、超时及观测错误；本地验证不代表失败的远端运行已恢复。

修复分支 `fix/database-integration-pool-teardown` 的本地验证：

- 新增 10 项单元、3 项原生回归；真实 Pool 已结束但客户端尚未关闭时屏障继续等待，残留连接超时后仍可查询；第三项精确限定测试数据库与 PID，显式捕获并断言旧清理方式产生一次 `57P01`，不忽略其他错误。
- 专用 PostgreSQL 18.4 / pgvector 0.8.6 上完整 `test:migrations` 连续三轮各 321 项通过：首组 160、Topic 5、Runtime 50、ACL 14、writer 92。普通单元测试跳过的原生项目不计为单元通过。
- 整仓 1634 项单元测试通过（database 1191、content 372、search 28、web 43），构建／类型检查／lint 的 Turbo 16 项任务成功，12 项复用缓存；格式与 diff 检查通过。
- 业务 `src`、全部历史迁移、角色授权 SQL、依赖锁与 CI 工作流不变；只增加测试脚本的套件接入。以上为提交前本地证据，修复通过独立 PR 交付，PR CI／评审／合并及后续 main CI 另行确认；未操作生产数据库。
