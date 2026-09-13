# 稳定事件身份：V2-1b 第二批实施契约

本批承接 [Signal V3 快照](SIGNAL_V3_FOUNDATION.md) 与[人物任职](PERSON_ORGANIZATION_AFFILIATIONS.md)，实现事件键登记与无副作用的登记预演。它不等于 AI 语义去重、实际导入或并发发表服务已经完成。

> **后续实施更新（2026-09-13）：** [PR #70](https://github.com/hzense/tech-intelligence-hub/pull/70) 已合并为 `d598eee`，对应 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34755795599) 全部通过，包含 56 项原生 PostgreSQL 集成测试，本地 main 已同步。下文保留当时本地验证记录。新增 `0007` [事务封存](SIGNAL_VERSION_IMMUTABILITY.md)进一步禁止已提交事件身份被普通 DML 改删；首次登记仍可在后来的事务中引用已有版本。未执行生产迁移。

## 什么是事件键

`event_key` 是经过明确身份判断后分配的规范标识，不是新闻标题、原文 URL、采集时间或可变事件日期的哈希。同一事件的多篇报道应先查找既有键，复用已有 Signal 并补充证据／修订版本；不能为每篇报道新建正式 Signal。

- 键沿用旧 Seed 可读 slug 语法：小写 ASCII 字母／数字组成的非空段，以单个 `-` 分隔；本批最大 200 字符。不做静默 trim、大小写转换或 Unicode 归一化。
- 签约、交割、投产等不同阶段明确分配不同键；相似标题或相同 URL 不足以证明同一事件。阶段间的关联图尚未实现。
- 日期更正、标题改写、来源变化不自动改键。若原身份本身错误，须后续专门协调合并／拆分、更正和已发表依赖，不能直接覆盖登记。
- 身份不确定、未分配键或仅有 legacy 键提示时保持暂缓，不生成占位身份。

登记规范只能防止同一个已分配键重复占用，不能发现两个不同键实际指向同一事件，也不能证明调用方的身份判断真实。后续 AI 只提出身份候选；正式接收仍需事实、证据与权限校验。

## 数据库约束

追加 `0006_signal_event_identity.sql`，不修改历史迁移。仓库目标变为 7 份迁移、24 张表（含迁移账本），不代表生产已经应用。

新增私有表 `signal_event_identities`：

| 字段                | 约束与含义                                                     |
| ------------------- | -------------------------------------------------------------- |
| `signal_id`         | 非空白主键；一个 Signal 最多一条规范事件登记                   |
| `event_key`         | 非空、规范 slug、最多 200 字符、全局唯一；不按发表状态释放占用 |
| `basis_version`     | 正整数版本号，指定首次登记所依据的 Signal 版本                 |
| `basis_evidence_id` | 非空白证据 ID，与 Signal 和版本共同构成证据锚点                |
| `identity_basis`    | 非空白身份判断说明；不是机器验证事实为真的证明                 |

复合外键 `(signal_id,basis_version,basis_evidence_id)` 指向 `signal_version_evidence(signal_id,version,evidence_id)`，通过既有外键链关联 Signal、版本和公开原文证据；不能借用其他 Signal／版本的证据。所有外键 NO ACTION，不级联删除登记。一个锚点用于追溯首次身份判断，其他报道继续使用原有多证据关系，不追加新的键。

跨行唯一性和引用一致性由唯一索引与外键承担，不能用读取别的行的普通 CHECK 代替。[PostgreSQL 约束说明](https://www.postgresql.org/docs/18/ddl-constraints.html)

数据库外键只保证证据关系存在，**不保证该证据支持身份、已核验或仍有公开资格**。本批不增加 Trigger、函数、角色或授权，现有 verifier 继续拒绝未知对象和权限；迁移 owner 仍能更新或删除合法登记，因此不能声称已具备数据库不可变保护。

## 登记预演

内容包提供严格的最小字段投影解析与纯函数预演，不连接数据库、不请求模型、不读取时钟、不下载来源，也不修改输入。

代码入口为 [`packages/content/src/event-identity.ts`](../packages/content/src/event-identity.ts)，经 `@hzense/content` 导出：

- `parseSignalEventIdentityCatalog(input)`：目录包含 `signal_versions`、`signal_version_evidence`、`public_source_evidence`、`signal_event_identities` 四个集合。
- `planSignalEventIdentities(catalog, proposals)`：返回稳定排序的计划数组；每项包含 `signal_id`、`event_key`、`action`、`reason`，仅 `register`／`no_change` 附带完整 `identity`。
- proposal 必填 `signal_id` 和 `identity_status`（confirmed／uncertain／legacy_hint）；键、版本、证据 ID 和说明允许省略／null，缺失时不补默认值。提供了这些字段则必须满足格式与引用约束。

目录重复身份、失效引用、跨版本锚点和未知字段拒绝；提案的 Signal 必须已有版本投影，已提供的版本／证据引用必须存在。完整数据库行应由调用方显式投影后传入，不能静默丢弃额外字段。完全相同的批次重复提案视为非法输入，与对已有登记的合法重试区分。

只有显式确认的身份、合法键、完整锚点，且锚点为 `supports`、原文为 `verified`，才可能进入可登记计划。同版本存在尚未拒绝的反证时保守暂缓；context 不构成支持。这些是已记录状态的预检，不是独立事实核验。

| 结果        | 含义                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| `register`  | 当前输入满足登记预检且未占用，只生成计划，不执行写入                    |
| `no_change` | 完整登记与现有记录相同，且当前证据预检通过；不重复写入                  |
| `conflict`  | 同键不同 Signal、同 Signal 不同键，或已有登记锚点／说明发生变化；不覆盖 |
| `deferred`  | 身份不确定、仅有旧键提示、缺少键／依据或证据未满足条件                  |

批次内部的身份冲突同样阻断所有冲突项，不按输入顺序选择赢家。完全相同的重试与冲突必须区分；不能用无条件 `ON CONFLICT DO UPDATE` 覆盖旧身份。预演结果不是持久化凭证：未来写入事务必须重新读取并锁定当前记录、校验证据，并处理唯一约束竞争。本批没有自动合并旧 Signal、分配新 Signal ID 或发布／撤回接口。

证据被拒绝后不自动释放已登记键，避免同一事件再次生成新 Signal；是否撤回当前公开版本由后续协调事务负责。新证据到来不静默替换初始锚点，也不能因 `no_change` 直接认为可发表。

## 兼容与上线边界

- 保留 `3.0.0` 快照字段和指纹，事件登记位于独立表。旧 Seed、旧 Daily 的 URL 回退规则、历史导入预演和公开页面不变。
- 现有旧 `event_key` 只是历史提示，不因格式合格自动写入本表；没有键的旧 Signal 也不补造键、人物或原文证据。本迁移只建空表，不回填旧数据。
- 不向 Runtime、Topic Sync、搜索同步角色开放新表，不创建云资源，不新增本地生产维护入口，不启用 AI 自动发布。
- 生产迁移需另行确认；要求最新 Schema 的维护预检仍将未应用的 `0004`–`0006` 报为 pending，不能绕过或自动执行来解锁，也不重新安排已取消的恢复演练。
- 不可变保护见后续 `0007` [事务封存契约](SIGNAL_VERSION_IMMUTABILITY.md)；之后是受限发表／撤回事务及 Outbox，再进行历史导入和统一读取切换。

## 验证记录

2026-09-13 本地实现与验证：

- 整仓 `pnpm build` 通过，旧 Web 仍生成 176 个页面；`pnpm test` 共 1081 项通过（Content 343、Database 667、Search 28、Web 43）。lint／typecheck／format、内容 62 文件及引用、Seed 与 5 个工作流校验均通过。
- 新增 97 项内容测试与 5 项数据库单元／结构测试，覆盖规范键、未知字段、严格引用、确定性批次冲突、完整重试、部分字段变化、证据失效、legacy 提示不提升以及无输入修改。
- 增加 3 项原生 PostgreSQL 集成用例：唯一键／同版本证据／最小权限，正则分组篡改检测，以及双连接争用同键（确认实际锁等待后仅一方提交成功）。本机无专用 PostgreSQL 测试连接，全部 56 项原生集成本地跳过，尚未获得本批 PR CI 证据。
- 项目外临时 PGlite 0.5.8（PostgreSQL 18.3 wasm、pgvector 0.8.1）执行全部 7 份迁移并复用完整 catalog collector：24 表零差异。独立复跑本批单连接集成主体，41 项非法 SQL 被拒绝，PUBLIC 权限检查为 false，回滚后结构零差异。
- 独立核验 7 种篡改均被拒绝：放宽 CHECK、移除唯一索引、缩窄外键、改为级联、改变正则分组、改变正则大小写和字面量空格。过程中发现旧通用表达式归一化会抹掉正则括号；本批新表改用保留完整字符串字面量／带引号标识符的比较，并补回归。旧表的比较合约未扩大或放宽。
- PGlite 不是原生多连接、网络与完整角色矩阵的替代品。临时验证依赖不写入项目 package.json 或锁文件，也不新增生产运维工具。
- `0006` SHA-256：`1dcef8dd9ab4e34f994a1e506f8a5a9685a412409e15db02766bc4215ae3740f`；历史 `0000`–`0005` 不变。未修改 Seed、旧快照指纹或公开页面；本批通过 PR 交付，远端 CI、评审与合并结果另行确认，未部署或执行生产迁移。

单元／结构校验、补充 SQL 验证、原生 PostgreSQL 集成、PR CI 与生产执行分别记录；跳过不算通过。
