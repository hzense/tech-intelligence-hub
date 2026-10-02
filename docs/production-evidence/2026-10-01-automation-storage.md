# 自动任务配置存储准备

日期：2026-10-01（Europe/Berlin）。本记录不包含凭证或完整连接串。

## 已确认

- PR #182 已合并至 `63ecf2666ba8c82be142a807a484dc6da1db4785`；本批开始时本地与远端 main 一致，工作区干净。该 PR 只移除领域选择，不代表启用自动采集。
- 受保护的 [Production maintenance 36881238232](https://github.com/hzense/tech-intelligence-hub/actions/runs/36881238232) 经用户环境审批执行 `operation=preflight`，返回 `status=succeeded`、`pendingMigrationCount=1`。没有执行迁移或授权；只读预检成功不等于完整 Schema／新角色 ACL 核验成功。
- `vercel env ls production` 的变量名称清单不含 `HZENSE_AUTOMATION_DATABASE_URL`、`HZENSE_AUTOMATION_ENABLED`、`HZENSE_AUTOMATION_BATCH_LIMIT_MICROUSD`、`HZENSE_AUTOMATION_DAILY_LIMIT_MICROUSD`、`HZENSE_AUTOMATION_RESERVE_MICROUSD` 或 `HZENSE_INSIGHT_READER_DATABASE_URL`。未读取密码、导出 Secret 或改动环境。
- 仓库自动任务存储定义为 `0026_automation_tasks.sql`：`automation_configs`、`automation_runs` 和受过滤的 `published_topic_insights` 视图。角色创建／授权脚本为 `db/roles/create_automation_roles.sql`、`db/roles/configure_automation_roles.sql`；不能借用迁移角色作为应用连接。

## 本批代码与提交前验证

- 配置连接不再依赖执行开关；原 Worker 连接仍须 `HZENSE_AUTOMATION_ENABLED=1`，共享同一受限连接池，未新增角色权限。
- 保存未启用配置不要求运行预算或导入／生成服务开启。仍核验模型配置；不调用 AI，不派发 Workflow。
- 页面保留可选关键词，区分存储和执行状态；运行与定时开关在执行未就绪时不可开启。关闭既有计划仍允许保存。
- Web 默认测试 756 项通过、14 项环境相关跳过；另显式启用自动采集浏览器回归 1 项通过。Web 类型检查、修改文件 ESLint 和差异格式检查通过。覆盖执行关闭时保存空／非空关键词、缺少存储时禁用保存、执行与定时禁用、专用角色校验、执行关停后再次阻断、公共 Reader 门禁及重复请求不重复派发。
- 本节记录提交前验证；PR、CI 与部署结果需在发布时另行核对。合成测试不等于生产保存验收，也未验证真实模型联网能力。本次代码发布不包括生产迁移、授权、存储凭证配置或开启采集。

## 生产待办和权限边界

### 本次启用准备

- PR #183 已合并至 `95f1f4748c1bdc436b286079124b716cc7ec0a38`；PR CI 和 [main CI 36885530601](https://github.com/hzense/tech-intelligence-hub/actions/runs/36885530601) 通过。生产域名已核验新提示和可选关键词，但保存仍因专用存储未就绪而禁用。
- 用户已明确接受本次 0026 的恢复未演练风险，授权保留新备份后准备迁移、专用角色最小授权和生产连接；这不代表恢复演练通过，也不授权开启采集或调用 AI。
- 当前提交的只读 [preflight 36889436427](https://github.com/hzense/tech-intelligence-hub/actions/runs/36889436427) 经审批成功，输出 `pendingMigrationCount=1`，未执行迁移或授权。
- 新增独立 `accept-unverified-automation-storage` 维护审批范围：固定 27 个迁移文件的名称及校验值，只允许待迁移集合为 `0026_automation_tasks.sql`；绑定数据库目标、新备份引用、提交、运行／attempt、过期时间和 ACL 基线，执行锁内重查真实连接及实际执行文件。旧 0025 和更早范围保持不变。
- 本地数据库包 2,366 项测试通过、688 项环境相关跳过，工作流合约及修改文件 ESLint 通过。测试使用合成维护依赖，不是生产迁移证据。
- 用户已确认维护期间无其他生产 DDL、角色授权或发布。Neon 新备份已从 main 复制数据和结构，控制台确认成功，保留至 `2026-10-08T16:18:26Z`；公开记录仅保留备份引用的 SHA-256：`62cc5eecaaf3b2f581c1a6c49cab47d52220d1dadb7d850c6f59ca1120c111f6`。此记录不是恢复演练证明。
- PR #184 已合并至 `c785bd86979cea614d4105ce09b23f873af53eae`，[main CI 36891974435](https://github.com/hzense/tech-intelligence-hub/actions/runs/36891974435) 成功。2026-10-02 核对远端 main 未变化。
- 用户审批后的 [preflight 36893011427](https://github.com/hzense/tech-intelligence-hub/actions/runs/36893011427) 成功，仅待迁移 `0026_automation_tasks.sql`。返回的清单、计划、目标与备份指纹与本地基于固定迁移文件和环境目标的独立计算一致：清单 `cdecb0b08a98525964e4767349e611a9c1de949c64e2ceddb9e3e82bac0200b6`；计划 `29035ab1e7e01e02cb4e0fa96495d3f698762047a1c51426aa43f3b64ccd80e9`；目标 `20fcbd27026b783fcc1cadf1a39a388925d9c73057baa71c7a5f6ba1c1a644e0`。
- 只读 [ACL capture 36981656993](https://github.com/hzense/tech-intelligence-hub/actions/runs/36981656993) 已经环境审批成功执行，于 `2026-10-02T08:03:18Z` 完成。回执为 `status=succeeded`，ACL 指纹 `a81b8dbf69eb1803aecfdb3346962eb0848907c73011dc5b6e919a8c97d6fdbb`，目标与备份摘要匹配上述预检，`recoveryVerified=false`。附件 `acl-evidence-36981656993-1` 已成功归档（36,542 字节，回读时未过期）。此处依据运行回执及附件元数据，不声称已独立下载复核附件内容或恢复演练通过；本次未执行迁移、授权或 AI 调用。
- 按用户后续要求，新增同一受保护 job 的一次审批入口：prepare 预检／双采集 → 远端归档成功 → apply 迁移／独立核验。它必须使用新提交及当次绑定的完整审批，并在同一 run 重新采集 ACL；不复用上述单步运行的批准或基线充当新组合运行的证据。实现与本地验证见[单次审批维护说明](../ONLINE_MAINTENANCE.md#0026-单次审批维护)。
- 尚待新入口上线后的当次迁移审批、迁移／独立 verify、角色与凭据配置、禁用执行状态下的保存验收。不得复用旧维护审批或填写虚构备份／恢复证据。

1. 保留当前生产备份；重新核对当前 main、CI、待迁移及维护窗口。生产写入使用受保护维护流程与当次绑定的审批，旧审批不得复用。未完成恢复演练时须明确接受该风险。
2. 经单独授权执行待迁移，完成完整 Schema 只读核验，再按审核脚本创建及配置最小权限角色。新密码由用户在安全界面设置并保管。
3. 将专用存储连接保存为 Vercel Production Secret `HZENSE_AUTOMATION_DATABASE_URL`，部署拆分后的代码；保持采集执行关闭，不开启专题公开读取。
4. 以一个未启用配置验证保存、刷新读回及无新增运行记录。关键词留空和非空均应可保存。
5. 付费运行、预算数值及定时计划启用另行确认；本批不调用模型、不发布 Signal 或洞察。
