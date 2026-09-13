# Signal 数据底座：V2-1a 实施契约

本批冻结 Signal 快照的机器契约 `3.0.0`，对应产品重构的 V2-1a。它与旧内容模型 `2.0.0` 并存；并不代表数据库权威切换或整个 V2-1 已完成。

## 本批范围与安全边界

- 保留 `signals` 的稳定 ID、现有字段和全部约束，作为旧兼容快照；新增版本通过外键引用该 ID。事实、时间或公开来源不完整的采集线索仍属于未来候选模块，不向旧表填造占位值。
- 新增私有的版本快照、多来源证据边、类型化人物／组织档案及版本上的人物／组织／Topic 关系。
- 仅实现历史导入的纯函数预演，不连接数据库，不新增本地生产运维工具，不写 Seed、不发模型请求、不发表内容。实际导入事务、幂等写入、同名消歧、任职时间线和人物补证后续单独交付。
- 没有 `published` 状态、公开版本指针、Outbox 或 Worker 写入入口；本批任何记录均不构成新版公开资格。版本的数据库级不可变保护与并发发表／撤回服务尚未实施。
- 不授予 PUBLIC、Runtime、Topic Sync 或搜索同步身份任何新表权限，不引入函数、Trigger、视图、RLS 或云资源；现有严格预检继续有效。迁移角色作为表 owner 仍可维护数据，不能声称 owner 也无法修改历史快照。
- 旧公开页面、搜索同步器、Daily 定时任务和生产配置不切换；待发布与读取链路完整后统一迁移。

## 物理契约

追加 `0004_signal_version_foundation.sql`，不修改已应用的历史 SQL。下列是仓库迁移目标，不是生产已执行证明。

| 表                             | 约束与用途                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `person_profiles`              | `entity_id` 主键；`entity_type` 固定 person，通过 `(entity_id, entity_type)` 外键复用 `entities(id, type)`                          |
| `organization_profiles`        | `entity_id` 主键；类型限 company/institution，同样使用类型化复合外键                                                                |
| `public_source_evidence`       | 来源 ID、HTTPS 原文 URL、定位文字、原文片段、SHA-256 内容指纹、采集与原文发表时间、核验状态；“public”描述来源，不表示数据库读取权限 |
| `signal_versions`              | `(signal_id, version)` 主键；完整正文快照、发生时间及精度/依据、采集时间、评分、修订理由、来源类型、旧状态、内容指纹                |
| `signal_version_evidence`      | `(signal_id, version, evidence_id)` 主键；版本与多证据、具体断言及 supports/contradicts/context 关系                                |
| `signal_version_people`        | 人物档案、事件角色、核验状态；证据必须属于同一 Signal 的同一版本；一人可关联多条证据                                                |
| `signal_version_organizations` | 组织档案、subject/participant/background 事件角色、核验状态；同版本证据外键                                                         |
| `signal_version_topics`        | 版本与规范 Topic 的多对多关系，不改变 Git Taxonomy 权威                                                                             |

`entities(id,type)` 新增唯一索引以支持类型外键。所有新增外键使用 NO ACTION，不级联删除历史快照／证据。人物不能用公司 ID 冒充，已被类型化档案引用的实体不能随意改型。同版本多条证据允许复用；不同 Signal 或版本的证据边不能串接。

快照字段：`signal_id`、正整数 `version`、固定 `schema_version=3.0.0`、`title`、`type`、`occurred_at`、`date_precision`（day/instant）、`date_basis`、`captured_at`、`summary`、可空 `analysis`、`importance`、`strength`、`confidence`、`novelty`、`revision_reason`、`origin`（legacy_seed/pipeline/manual）、可空 `legacy_status`、SHA-256 `content_hash` 和数据库 `created_at`。`legacy_status` 当且仅当 origin=legacy_seed 时存在。评分沿用原范围；空白正文、无依据时间、非正版本及错误指纹必须拒绝。

快照指纹按机器契约固定字段序列的 UTF-8 JSON 计算，排除 content_hash 和数据库生成的 created_at；事件／采集时间在指纹中统一为 UTC ISO 毫秒格式，使 PostgreSQL／pg 读回等价时刻不改变指纹。机器输入最多接受 3 位小数秒，更高精度明确拒绝，不能静默截断；旧输入的原始时间字符串仍保留在预演目录及计划指纹中。数据库 CHECK 校验字段与指纹格式，不重新计算 SHA-256，也不能替代证据真实性核验。

证据只能来自明确的公开原文。尚未下载、核验的 Seed 摘要不能冒充原文片段，也不能伪造原文哈希或 source_published_at。私有上传与文档版本将在 V2-2 的专用数据结构中保存，不强塞 HTTPS 地址。本批预演只保留 legacy source reference，不创建已核验的证据或人物边。

## 历史导入预演

输入为经过现行 Seed 结构和引用校验的目录，输出确定性预演计划和内容指纹：

1. 保留 Signal ID、原始 occurred_at/captured_at、类型、摘要、评分、来源 ID/URL、Topic 和 Entity 引用及原始状态，不使用本次执行时间覆盖事件时间。
2. 未有独立日期精度证据的旧零点时间按 day 存储约定记录，不宣称事件恰在午夜发生；非零点时间按原始 instant 保留。date_basis 明确来自旧 Seed，后续仍可核验修订。
3. 不推断人物或把记者、CEO 自动绑定到事件；旧 accepted/reviewed 只说明旧 Seed 展示条件。输出旧公开候选数与内部记录数，所有记录保持新版未发表／待核验。
4. 相同输入及无序目录／集合引用的不同排列应产生相同计划；Radar 的 evidence_signals 是有序证据，保持原顺序并参与计划指纹。重复 ID、非法来源／时间、失效引用拒绝；现有快照比较必须精确匹配，不能用 ON CONFLICT 覆盖历史。
5. 输出不包含数据库凭据、下载后的原文或伪造的证据。正式 apply、旧站已公开清单与屏蔽状态核对、数据库历史冲突校验仍是后续阶段，预演不证明入库或发表成功。

## 后续 V2-1b / V2-1c

V2-1a 已通过 [PR #68](https://github.com/hzense/tech-intelligence-hub/pull/68) 合并为 `22e137a`，PR 及 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34726612068) 均通过，包含此前本机跳过的 51 项 PostgreSQL 集成测试；这不是生产迁移证明。

下一增量见[人物—组织任职契约](PERSON_ORGANIZATION_AFFILIATIONS.md)：复用旧关系方向和时间字段，追加任职扩展及证据关系，不改变本页的 `3.0.0` 快照指纹。仍需补齐候选／文档模型、稳定事件键、不可变版本保护、当前资格、发布与撤回事务、分离角色、Outbox、历史导入事务和统一读取接口。发表服务必须在事务内重新检查人物与证据、授权、当前开关、取消及租约；禁止将本批结构校验当成真实事实核验或可公开许可。

## 验收与部署

本批测试覆盖类型化外键、跨版本引用拒绝、多证据、数值／时间字段、旧内容无损预演及无虚构人物。Migration manifest、Drizzle Schema、精确 catalog verifier 和集成测试同步更新。PostgreSQL 集成测试需要专用本地／CI 测试数据库；跳过不能计为通过。

合并后生产仍停留原 schema；新增迁移可能使要求最新 schema 的维护预检报告 pending migration，这是预期的失败关闭边界。不得仅因预检阻塞而自动应用迁移；发布需另行确认维护范围、最新审查、备份／风险接受和生产验证。不重启已取消的恢复演练。

### 2026-09-13 本批本地验证

- `pnpm build`：4 个工作区构建通过，旧 Web 路由继续生成。
- `pnpm test`：Content 160、Database 658、Search 28、Web 43，共 889 项通过；另 51 项真实连接的数据库集成测试因本机没有专用测试连接而跳过，不能计为通过。
- Content／Database 的 typecheck、lint 通过；内容、Seed 与工作流校验通过。新内容契约测试共 76 项，真实 Seed 测试按输入数量动态断言，不固定未来 Signal 总数。
- 只读预演：当前 82 条 Signal，82 条旧展示候选、0 条内部记录；全部 82 条保持新版 unpublished／pending_verification。未创建人物或原文证据，未执行导入。
- 补充 SQL 验证使用项目外临时安装的 [PGlite](https://pglite.dev/docs/) 0.5.8（PostgreSQL 18.3／pgvector 0.8.1）：全部 5 份 DDL 可执行，复用只读 catalog collector 校验 21 表零差异；故意放宽人物 CHECK 后被 verifier 拒绝；23 个非法写入被拒绝，多证据可保存，非授权 Reader 读取版本表被拒绝。
- 该补充测试不等同于 CI 的 PostgreSQL 18／pgvector 0.8.6、网络连接、锁竞争和完整分离角色集成矩阵；后者仍需 PR CI。临时依赖未加入项目 package.json 或锁文件。
- `0004` SHA-256：`caab5e3b1827eec0fe5410c6935b71c4142e09fcb6a66029d225d3f841e4ad2e`；历史 `0000`–`0003` 未改动。
- 本记录仅证明本地验证；本批通过 PR 交付，远端 CI、评审与合并结果另行确认。未部署，也未连接或修改生产数据库。
