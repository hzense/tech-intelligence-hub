# 人物—组织任职：V2-1b 首批实施契约

本批承接 [Signal V3 数据底座](SIGNAL_V3_FOUNDATION.md)，实现人物任职的内部数据结构、证据关联和保守的按日判断。它是 V2-1b 的第一项，不包含稳定事件键、不可变发表事务、受限发布角色或 Outbox，也不表示资源页面已切换数据源。

## 身份与关系粒度

- 继续使用 `entities` 的人物／组织 ID，以及 `relations.id` 的关系 ID，不新建另一套身份库。名字相同不等于同一个人；本批不自动消歧、合并身份或推断 CEO。
- 一个 `relation_id` 表示一段具体任职事实／职务。同人同组织返聘、不同职务、不同组织兼任允许多个 ID；不对人物—组织组合设唯一约束，不禁止合法重叠。
- 任职类型仅限现有词表中的 `works_at`、`leads`、`advises`。`founded`、`invests_in` 等其他有向关系仍留在通用 `relations`，不能把创始人／投资人身份自动当作当前任职。
- `person_id` 必须是 Person 档案，`organization_id` 必须是 Company／Institution 档案。复合外键要求关系 ID、起点、终点和类型同时匹配；不能拿另一条关系的 ID 冒接，也不能反转人物→组织方向。

## 物理结构

追加 `0005_person_organization_affiliations.sql`，历史 `0000`–`0004` 不变。仓库目标变为 6 份迁移、23 张表（含迁移账本）；这不是生产执行证明。

| 对象                               | 本批约束与用途                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `relations`                        | 继续作为方向、类型、`valid_from`／`valid_to` 的唯一来源；新增 `(id,source_id,target_id,relation_type)` 唯一索引和日期合法性／顺序 CHECK |
| `person_organization_affiliations` | `relation_id` 主键；人物、组织、类型须复合匹配通用关系；保存 `role_title`、`date_basis`、`verification_status`，不复制有效期            |
| `affiliation_evidence`             | `(relation_id,evidence_id)` 主键；关联任职与 `public_source_evidence`，保存 `claim`、supports／contradicts／context 关系及独立核验状态  |

所有新增外键均为 NO ACTION，不级联删除任职或证据。职务、日期依据、断言拒绝空白文本；核验状态限 pending／verified／rejected，默认 pending。人物、组织和反向证据查询有索引。

同一网页不同段落可以是不同的 `evidence_id`；不能仅按 URL 去重而丢弃支持／反驳证据。当前复合主键约定每段证据对一段任职保存一条断言及证据关系，复杂多断言应拆为可定位证据，不覆盖既有反证。

日期 CHECK 作用于整个 `relations` 表，而非仅新增任职行。既有非法日期会使迁移失败；本批不清洗、猜测或覆盖历史值。跨表身份使用外键，不能用读取其他行的普通 CHECK 代替持续一致性约束。[PostgreSQL 约束说明](https://www.postgresql.org/docs/18/ddl-constraints.html)

## 时间语义：不把未知当作现任

日期只接受真实的 `YYYY-MM-DD`，范围 `0001-01-01` 至 `9999-12-31`。已知的 `valid_from` 不得晚于 `valid_to`；同日任期合法。数据库同时拒绝无穷日期。选择该范围是机器日期契约的限制，不是 PostgreSQL 日期类型自身的完整取值范围。[PostgreSQL 日期类型说明](https://www.postgresql.org/docs/18/datatype-datetime.html)

有效期采用包含首尾日的闭区间，按以下规则返回 `within`、`outside` 或 `unknown`：

| 已有时间信息                           | 查询结果  |
| -------------------------------------- | --------- |
| 查询日早于已知开始日，或晚于已知结束日 | `outside` |
| 起止都已知且覆盖查询日                 | `within`  |
| 仅一个端点已知，查询日恰等于该端点     | `within`  |
| 其余缺少端点的情况，包括两个端点均为空 | `unknown` |

`null` 表示不知道，不是负／正无穷，也不是“至今”。只有年月时不补造月初／年初，保留空值并在 `date_basis` 说明。函数需要调用方明确提供查询日期，不读取当前时钟，不用采集日替换事件日。

`within` 仅表示所给日期覆盖，不代表事实已核验、此人现任或可以公开。未来展示当前人物还需有据的观察时点／新鲜度规则；本批不实现该推断。同日离职和入职可能同时覆盖当天，不能据此为时刻级 Signal 自动选择雇主。

## 证据与结构预检

内容包提供独立、严格的目录解析，检查人物／组织类型、关系方向和类型、日期、重复 ID／证据边、失效引用以及未知字段。允许待核验任职暂时没有证据，以便后续补证；不会据此创建人物或将旧 Seed 关系提升为已核验。

证据状态评估与时间判断分开：只有任职状态、支持边状态和对应原文证据状态均为 verified，才可能返回 `supported`。未被拒绝的反驳边及其证据构成待解决冲突，不能被一条支持边覆盖；context 不计为支持。`conflicted` 表示有待处理反证，不表示机器已确认事实为假。已拒绝和待核验状态不能被误当作支持。

这些函数只校验结构和已记录状态，不下载原文、不验证事实、不完成发表授权。未来发表事务仍需锁定并重新核验当前依赖，不能把一次内存预检当作永久有效的发表凭证。

代码入口为 [`packages/content/src/affiliations.ts`](../packages/content/src/affiliations.ts)，由 `@hzense/content` 导出：

- `parseAffiliationCatalog(input)`：解析最小字段投影，包含 `entities`、`relations`、`affiliations`、`public_source_evidence`、`affiliation_evidence` 五个数组；不是把完整数据库行直接传入后静默丢弃额外字段。
- `classifyAffiliationPeriod({ valid_from, valid_to }, on)`：对明确的日历日期返回 within／outside／unknown。
- `assessAffiliationEvidence(catalog, relationId)`：返回 supported／pending／conflicted／rejected；任职本身已 rejected 时优先返回 rejected。未知关系或非法目录直接拒绝，不产生乐观默认值。

## 权限、兼容与后续

- 不添加授权、数据库角色、函数、Trigger、视图或云资源。Runtime、Topic Sync、搜索同步身份没有新表权限；严格 verifier 不放宽。
- 不修改旧 Seed、现有公开路由、搜索索引或 `3.0.0` Signal 快照指纹；旧 `relations.source_refs` 不是新版证据关系的替代品。
- 本批关系没有不可变版本保护，owner 仍能更改职务、日期和核验状态。历史发表快照的关系追溯、撤销协调和重评机制需后续发表事务实现，不能宣称已解决。
- 没有新增数据库连接入口、导入命令或自动写入。新增表仅随显式迁移应用；本轮不操作生产数据库。
- 合并后要求最新 Schema 的维护预检可能报告 `0004`／`0005` pending。不能自动应用迁移来解除门禁；上线前须独立审查旧关系日期、角色与维护流程兼容性，且不重启已取消的恢复演练。

下一批仍需稳定事件键、不可变版本及受限发表／撤回事务、Outbox；再进行历史导入事务和统一读取切换。

## 验证记录

2026-09-13 本地验证：

- `pnpm build`：4 个工作区构建通过，旧 Web 176 个页面正常生成；公开读取方式未变。
- `pnpm test`：979 项通过（Content 246、Database 662、Search 28、Web 43），其中本批新增 86 项内容契约测试和 4 项 Schema 测试。另 53 项原生 PostgreSQL 集成测试因没有专用本地连接跳过，不能计为通过。
- 新增两项原生 PostgreSQL 集成测试，覆盖类型／方向／身份外键、日期／空白约束、返聘／兼任／多证据、最小权限，以及遇到旧非法日期时拒绝迁移且不改写旧数据。
- 在项目外临时 PGlite 0.5.8（PostgreSQL 18.3 wasm／pgvector 0.8.1）执行全部 6 份迁移，复用完整 catalog collector 核验 23 表零差异；刻意弱化日期范围 CHECK 后被拒绝。直接运行上述新增集成测试的回调，45 项非法 SQL 断言及合法边界、无 PUBLIC 权限验证通过，结束后再核验结构零差异。这是补充 SQL 验证，不替代 PR CI 的原生 PostgreSQL 18／pgvector 0.8.6、网络、锁竞争和完整角色矩阵。
- 全仓 lint／typecheck／format 和 `git diff --check` 通过。内容校验 62 文件及引用通过；Seed 校验仍为 62 Taxonomy Topics、6 Seed Topics、19 Entities、8 Relations、82 Signals、5 Radar 快照，未更改旧数据。
- `0005` SHA-256：`0504823486759d05d604b0f9eefa94d6c2010c233cd6367658908d3d39b01ad8`，历史 `0000`–`0004` 未变，未增加项目依赖。

本批通过 PR 交付，远端 CI、评审与合并结果另行确认；未部署或执行生产迁移。单元测试、补充 SQL 测试、真实 PostgreSQL 集成、PR CI 和生产执行分别记录，跳过不算通过。
