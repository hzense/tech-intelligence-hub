# Signal 任务与发布控制：私有事务门禁底座

承接 [PR #72 的私有发表转换与 Outbox](SIGNAL_PUBLICATION_OUTBOX.md)，本批实现持久化任务意图、当前发布策略、授权记录、取消状态和执行租约。它是完整 Publisher 的前置部分，不是 AI 采集后台、公开发表入口或身份认证服务；未执行生产迁移，未启用自动发表。

> **后续交付（2026-09-13）：** 本批已由 [PR #73](https://github.com/hzense/tech-intelligence-hub/pull/73) 合并为 `f0fc283`，PR 与 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34763140875) 通过，完整原生 PostgreSQL 回归 260 项通过。后续 `0010` [已记录资格检查与原子发表](SIGNAL_QUALIFIED_PUBLICATION.md)正在本地交付：复用本门禁，在同事务检查已封存候选的记录资格、克隆新版本并写 Outbox／head／绑定回执；仍不是完整生产 Publisher。下文第 4–5 节保留 `0009` 当时的边界与验证记录。

## 1. 数据结构与默认值

追加 `0009_signal_publication_controls.sql`，保留 `0000`–`0008` 原校验和。

| 私有表                              | 用途与默认行为                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `signal_publication_control`        | 全局单例；迁移仅创建一条 `publication_enabled=false` 记录。缺失时拒绝，不推断为开启。                               |
| `signal_publication_tasks`          | 任务 UUID、当前策略与任务发布开关；默认 `preview_only` 且关闭。此处不是完整采集任务配置。                           |
| `signal_publication_authorizations` | 任务与操作者 UUID 的复合主键；当前 `can_publish` 默认 false。不是实体人物表，也不接受调用参数代替数据库授权记录。   |
| `signal_publication_runs`           | 不可改写的运行 ID、任务、操作者、原始意图、创建时间，以及当前状态、执行令牌和租约。复合外键绑定同一任务的授权记录。 |

策略支持 `auto_publish`、`review_required`、`preview_only`。工程默认关闭／预览不改变产品设计中 Signal 三入口默认自动发表的决定。将当前策略改宽不能提升旧运行的原始意图；预览或可选审核结果后续发布，须另建经授权的运行，不能修改原运行或恢复其旧租约。

本批 UUID 仅是私有持久化引用。未来后台必须将真实认证主体绑定到 `principal_id`，提供受限、可审计的配置与授权入口；知道 UUID 不等于获得权限。当前没有后台配置 API，也没有新增角色或 GRANT。

## 2. 生命周期与执行令牌

```text
pending ──领取（token + 1）──> running ──有效租约完成──> completed
   │                            │
   └────────取消───────────────┴───────────────────> cancelled
                                │
                                └─过期后重新领取──> running（token + 1）
```

- 原始意图、归属与创建时间不可变；终态不能恢复。运行记录禁止删除或 TRUNCATE，以免相同 ID 重建后让旧令牌再次有效。
- `fencing_token` 使用非负 int32，初始为 0，首次领取为 1。重新领取严格加一，达到上限拒绝，不绕回。令牌表示执行世代，不是 Signal 内容版本或发布修订号。
- 租约时长为 1–900 秒，时间使用数据库时钟。活跃租约不能抢占；即使是同一个执行者，也必须使用显式续租接口。续租要求当前 owner、token 与未过期租约匹配，且新截止时间确实延长。
- 同一任务通过私有适配器的任务行锁串行领取，最多存在一个有效执行租约；过期旧运行即使仍标为 running，也不能通过门禁。这是受信任接口及统一锁序保证，不是跨行唯一约束：owner 直接 SQL 不经接口仍能创建并行租约。未来运行角色不得取得绕过接口的任意写权限。此处不实现调度器或跨任务预算。
- 取消只锁定运行，不依赖发布开关、当前策略、授权有效性或执行租约；即使全局配置记录缺失仍可取消，重复取消返回原终态。完成要求控制记录存在及有效 owner/token/租约，但不要求发布开关仍开着。二者都不发表／撤回 Signal。
- 原生 ALWAYS 触发器独立限制初始状态、身份变更、终态恢复、令牌递增、续租／抢占时机和租约上限。普通 SQL／replica 会话也不能绕过这些生命周期规则。owner DDL 与直接改动授权记录仍属于外部可信管理边界。

## 3. 私有接口与事务边界

源码：[解析与控制规则](../packages/database/src/signal-publication-control.mjs)、[私有事务接口](../packages/database/src/signal-publication-control-store.mjs)。

- `createPrivatePublicationRun`：创建 pending 控制记录；相同 ID 和原始字段重试只返回原记录，不同原始字段冲突。创建 pending 不领取执行权，更不代表可以公开。
- `claimPrivatePublicationRun`／`renewPrivatePublicationRun`：检查持久化当前开关、策略、原始意图与授权，再领取／续租。只操作运行记录。
- `cancelPrivatePublicationRun`／`completePrivatePublicationRun`：结束运行，不更新公开内容。完成结果丢失后，不自动用新运行补发；完整任务执行回执与恢复流程属于后续后台。
- `lockPrivatePublicationControls`：只在调用方已有的显式 `READ COMMITTED` 事务中锁定并检查控制状态，不自行提交；不能在 autocommit 下获得“授权结果”。

发布控制锁定顺序为：全局开关 → 任务 → 授权 → 运行。创建额外先取得运行 ID 的事务级 advisory lock 防同 ID 不同请求竞争。领取以任务行 `FOR UPDATE` 串行化，其余父记录使用 `FOR SHARE`，能够阻止非主键的策略／授权改动；运行行使用 `FOR UPDATE`。取消仅锁运行，不再请求父锁，不形成逆序等待。所有多记录控制修改与未来 Publisher 必须遵守统一锁序；若控制撤销先提交，等待的门禁读取新值并拒绝；若门禁先取得锁，撤销等待这个短事务结束，不承诺抢占已经持锁的事务。

时钟在全部锁等待后使用 `clock_timestamp()` 读取。现有事务辅助器设置锁／语句／事务空闲超时，不跨模型或网络调用。借用连接必须属于独立短事务，不能伪装连接池嵌套已有事务。独立门禁用 `SAVEPOINT` 检查显式事务，成功释放 savepoint 但保留外层事务的锁，失败由调用方回滚；隔离级别不符直接拒绝。

上述锁与 savepoint 边界遵循 PostgreSQL 的[行锁规则](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS)和 [SAVEPOINT 契约](https://www.postgresql.org/docs/18/sql-savepoint.html)。

## 4. 尚未完成的发表边界

门禁返回的 `private_control_only` 是私有诊断信息，不是可复用授权票据、已核验内容或“搜索 ready”。事务结束或租约过期后不能沿用。纯函数也不能证明输入真的来自已锁定数据库。

`0009` 交付时的下一步是把当前人物／组织／证据／事件身份资格、必要的新版本组装、公开状态和 Outbox 写入放进**同一事务**，并在后续依赖锁等待后、最终写入前再次核对租约。此私有事务部分由后续 `0010` 实现，但不包含完整事实核验或公开许可。不能先调用本批门禁并提交，再调用自有事务的 `recordPrivateSignalPublicationTransition`，这样仍有检查与写入分离的竞态。

本批不将 gate 接到 `0008` 存储函数，不输出发表成功，不提供 Runtime／writer 权限，不实现安全撤回的认证与审计，也不接入公开视图、搜索消费者、缓存或 Seed Reader。独立安全撤回不能被暂停中的采集租约／预算阻塞，但不能用本批 `cancel` 代替 Signal 撤回。

原文更正扫描、来源／模型撤销、预算、生成步骤、私有上传、调度暂停与结果审核留待后续；本批不声称三类入口已能自动生成内容。

## 5. 验证与交付

回归覆盖严格请求解析、未知权限标记拒绝、当前策略与原始意图交集、数据库锁序、连接失败回滚、运行不可变、取消／撤销／策略变化与门禁竞争、过期等待、同运行及同任务并发领取，以及 Runtime／writer 越权拒绝。

2026-09-13 本地验证结果：

- 整仓构建、类型检查、lint 与 1432 项单元测试通过，其中 database 1018、content 343、search 28、web 43。最终 Turbo 执行 16 项任务全部成功，未改动包的 12 项任务复用缓存；普通单元命令跳过的原生集成另行执行，不计入单元通过数。
- 使用临时、独立的 PostgreSQL 18.4 / pgvector 0.8.6 集群，完整 `test:migrations` 的 260 项原生集成全部通过：迁移与数据事务组 111、Topic 角色 5、Runtime 角色 44、ACL 恢复 14、Signal writer 角色 86。集群仅绑定本机回环，TCP 使用 SCRAM，测试只使用合成凭据和数据，不连接 Neon。
- 上述原生集成包含新增控制套件 34 项，其中 13 项使用不同连接和真实锁等待覆盖取消、策略／授权撤销、租约过期、重复领取及同任务竞争；Runtime 与 writer 各新增 21 项拒绝访问检查。迁移 verifier 确认 10 个迁移、30 张表，独立函数／触发器目录校验通过。
- 验证时补齐了隔离集群确认参数并对齐 pgvector 版本；旧 writer 成功样例改用显式 UTC 日期，并在柏林时区事务中回归，消除对测试服务器默认时区的依赖。没有放宽日期精度、权限或生产预检规则。
- 格式、内容、Seed、工作流校验及 `git diff --check` 通过。`0000`–`0008`、现有角色授权文件和依赖锁文件均未改动。

原生测试沿用 CI 命令：`pnpm --filter @hzense/database test:migrations`，仅在真正可销毁的专用集群中设置 `MIGRATION_TEST_ADMIN_URL` 与 `RUNTIME_READER_TEST_ISOLATED_CLUSTER=1`。不在仓库保存连接串，也不使用此命令验证生产数据库。

以上为提交前本地验证记录，本批通过独立 PR 交付；PR CI、评审与合并结果另行确认，未执行生产迁移。上述测试不代表完整 Publisher、AI 后台或新版网站已上线；本地验证与各交付阶段分别记录，不互相替代。
