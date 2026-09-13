# Signal 版本封存与写入权限：V2-1b 第三批

承接[版本快照](SIGNAL_V3_FOUNDATION.md)、[人物任职](PERSON_ORGANIZATION_AFFILIATIONS.md)与[事件身份](SIGNAL_EVENT_IDENTITY.md)，本批先建立普通数据库写入不能改写历史的边界。它不是发表／撤回服务，不切换生产或旧站读取。

## 事务封存

追加 `0007_signal_version_immutability.sql`，不修改 `0000`–`0006`。仓库目标为 8 份迁移、24 张表（含账本）、3 个应用触发函数、14 个用户触发器；没有新增业务表。

`signal_versions`、`public_source_evidence` 和 `signal_event_identities` 新增 `created_xid xid8 NOT NULL DEFAULT pg_catalog.pg_current_xact_id()`。
它标记允许组装该记录的本数据库顶层事务，不是业务时间，不参与 `3.0.0` 快照指纹，也不能在 JavaScript 中转为 Number。Drizzle 将其作为字符串处理。

| 数据                                               | 创建事务内                                 | 创建事务提交后                                                     |
| -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `signal_versions`                                  | 可组装完整快照                             | 禁止 UPDATE／DELETE                                                |
| 四类 `signal_version_*` 证据、人物、组织、Topic 边 | 仅所属版本的创建事务可增改删               | 禁止追加、改写、删除或搬移                                         |
| `public_source_evidence`                           | 可组装原文证据                             | 仅允许有权限的核验路径修改 `verification_status`，其余字段全部冻结 |
| `signal_event_identities`                          | 可登记首次规范身份，也可锚定先前已提交版本 | 自身提交后禁止改写、删除或释放事件键                               |

完整版本及其所有边必须在**同一事务**内写入。提交后补证、改摘要或调整人物／Topic 关联，均需创建新版本并重新写入所需边；不能先单独提交空版本，再逐条追加边。该约束不要求已有公开原文证据或首次事件登记与版本在同一事务创建。

数据库保护不等于业务完整性校验：不完整版本仍可作为私有历史保存，但不能据此公开。未来组装入口必须先做严格结构校验，发表入口还必须检查当前事实与资格。此批不新增可调用的生产写入 CLI 或应用 API。

## 防绕过与资格边界

- INSERT 拒绝空／伪造 `created_xid`；UPDATE 判断旧 stamp，且不允许改变 stamp。不是比较可变的 `xmin`。
- 修改边时检查旧版本和新版本，防止把历史边搬到刚创建的版本；缺少父版本直接拒绝。
- SAVEPOINT 使用同一个顶层事务标识，不会重新开放其他事务的版本。`xid8` 带事务 epoch，不使用会回绕的 32 位 xid。[PostgreSQL 事务函数](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-PG-SNAPSHOT)
- 七张受保护表的行触发器与独立 TRUNCATE 触发器均为 `ENABLE ALWAYS`。函数固定 `SECURITY INVOKER`、安全 search_path、完整 schema 引用，并撤销 PUBLIC EXECUTE。不赋 Runtime／Topic Sync 新的数据读取或函数调用权限。
- owner／超级用户仍能通过 DDL 改函数、禁用触发器或删除表；这是受信任管理员边界，不宣称可以防管理员破坏。DDL 冻结、源码／迁移哈希与目录核验仍必要。
- 版本内人物／组织的核验状态属于冻结快照；公开原文的当前 `verification_status` 可被独立核验路径更新。原文后来被拒绝，不改写历史，也不会在本批自动下架内容。后续发表／撤回事务必须协调当前资格和公开投影，不能仅凭旧快照的 verified 继续公开。
- 本批不封存 `relations`／任职档案，不把当前职务当成历史事实。后续公开资格服务仍需对相关依赖做当前校验。

## 独立写入身份

`db/roles/configure_signal_writer.sql` 只配置**已由管理员创建**的 `hzense_signal_writer`。脚本不创建角色或密码，不修改其他身份，不执行全库 PUBLIC ACL 清洗；发现环境已有超出约定的有效权限时拒绝配置。

执行前必须在同一 DDL 冻结窗口通过完整 Schema verifier；角色脚本检查账本／stamp 和权限，但不替代函数正文与完整 Schema 校验。它也拒绝其他可连接数据库的有效 CONNECT／CREATE／TEMP 权限及所有角色 membership；Neon 的 provider 特例没有在本批默认豁免，实际配置前需单独核对。

该身份是受限的内部版本组装者，不直接给 AI 模型或普通上传入口使用，也不是发布者：

- 只允许 CONNECT、public USAGE、必要基础／快照表 SELECT，以及明确列清单的 INSERT。
- `signals.status` 不可写，保持默认 inbox；公开原文与人物／组织边的核验状态不可写，保持默认 pending。不能自行标记 accepted、reviewed 或 verified。
- `created_xid` 与 `signal_versions.created_at` 由数据库生成，不能指定。
- 无 UPDATE、DELETE、TRUNCATE、TRIGGER、REFERENCES、MAINTAIN、转授权、DDL、TEMP 或角色继承；不写搜索索引、Topic 投影、资源档案或公开状态。

这是权限配置契约，不是完整写入业务服务。可信快照的 hash、事件身份与证据语义仍要由后续受控事务重新检查。角色的实际 Neon 创建、provider membership 兼容和生产授权尚未执行，不能用 CI 的独立 PostgreSQL 角色结果替代。

此身份写入的 pending 人物／组织边随版本封存，不能直接升级为已核验公开版本。后续受控审核／发表路径必须创建包含已核验证据的新版本，不能为方便升级而给该 writer 追加 UPDATE 权限。

## 严格目录核验

`packages/database/src/signal-immutability-catalog.mjs` 提供独立的精确契约，供完整 Schema verifier、Runtime reader preflight 和 Topic sync preflight 共用。

除数量外，它检查每个触发器的表／函数／事件／粒度、ALWAYS、参数、WHEN、列过滤、transition table、约束及继承属性；检查函数 owner、语言、返回类型、安全模式、search_path、ACL 和经审核的正文 SHA-256；检查 stamp 类型／非空／默认值。未知应用函数和额外触发器仍拒绝。函数正文不使用会删除正则括号或字面量空白的表达式归一化。

## 迁移与验证边界

- 新列的易变默认值可能重写旧表并持有排他 DDL 锁；需在经过确认的维护窗口核对规模与影响。旧记录 stamp 是迁移事务，不是历史创建事务证明，迁移提交后冻结。
- 跨数据库逻辑导入不能无条件复制源库 stamp：事务编号不是跨集群唯一身份，必须在后续受控导入中重新绑定本地导入事务。此处仅明确契约，不新增恢复演练或生产导入工具。
- 单元测试覆盖精确目录和权限；原生 PostgreSQL 集成覆盖真实角色、跨事务封存及并发边界。未配置专用测试数据库时跳过，不能计为通过。
- 普通 Web 部署不会运行迁移；生产维护仍需单独审批并复核最新 Schema 支持。此批未访问生产数据库、修改凭据、开新云资源或启用自动发布。

后续按顺序：受限发表／撤回事务与 Outbox → 历史导入和数据库读取切换 → AI 后台与新版四个页面。本批封存完成不代表这些后续项已完成。

## 2026-09-13 本地验证记录

- `pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm format:check` 通过；内容 62 文件／交叉引用、Seed 和 5 个工作流校验通过。未变更旧站页面或数据。
- `pnpm test`：Content 343、Database 731、Search 28、Web 43，共 1145 项通过；相对 PR #70 增加 64 项单元／结构检查。
- 新增原生 PostgreSQL 封存集成 20 项、写入角色集成 55 项，包含真实双连接 READ COMMITTED／REPEATABLE READ、实际目录篡改、非 owner 登录和权限失败后无副作用核对；`test:migrations` 已显式接入。当前本机无专用管理员测试连接，连同既有用例共 131 项原生集成跳过，不能计为通过，仍需 PR CI。
- 项目外临时 PGlite 0.5.8（PostgreSQL 18.3 wasm／vector 0.8.1）执行全部 8 份迁移，完整 collector 核对 24 表零差异；50 个非法 SQL 被拒绝，10 类函数／触发器／默认值篡改被检出。另验证旧行迁移封存、SAVEPOINT、证据状态与历史载荷分离、后续首次身份登记。
- 同一隔离环境真实执行 writer 配置 SQL，首次与重复配置成功且幂等；普通角色无 guard EXECUTE 仍完成八表 pending bundle。11 类越权操作以 `42501` 拒绝；6 类不安全 ACL 配置被拒绝且前后 ACL 不变。此处 `SET ROLE` 模拟不替代原生登录、网络和双连接测试。
- `0007` SHA-256：`d076f9da8dd979a2bca4f54d4ed686783323dde29aa9f94bf7adeaf7b8fdd0ef`，历史 `0000`–`0006` 未变。临时验证依赖不写入项目依赖或锁文件。
- 本记录只证明本地开发与验证；本批通过 PR 交付，评审／CI／合并结果另行确认。未部署或访问生产数据库。
