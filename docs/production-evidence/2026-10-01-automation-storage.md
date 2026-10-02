# 自动任务配置存储准备

日期：2026-10-01（Europe/Berlin）。本记录不包含凭证或完整连接串。

## 2026-10-02：0026 迁移与独立核验已完成

- PR #185 已合并，执行提交为 `46c13ff076815c5dd3fca1df5fbbb1481dbf6805`；对应 main CI 成功。
- 用户确认维护冻结并完成一次 Environment 审批后，[组合维护 36990002049](https://github.com/hzense/tech-intelligence-hub/actions/runs/36990002049) 的 attempt 1 于 `2026-10-02T09:40:20Z` 成功结束。预检、ACL 独立双采集、安全落盘、远端归档、迁移及独立完整 Schema 核验均通过。
- 最终回执为 `operation=migrate-and-verify`、`status=succeeded`、`pendingMigrationCount=0`、`verificationCompleted=true`、`migrationCount=27`、`tableCount=60`。27 为完整迁移计数，本次预检仅待迁移 `0026_automation_tasks.sql`，不是本次重跑了 27 条迁移。
- 本 run ACL 指纹为 `a81b8dbf69eb1803aecfdb3346962eb0848907c73011dc5b6e919a8c97d6fdbb`，清单、计划、目标及备份指纹与下方记录一致。本次审批摘要为 `9e8c9a4c86d1363cfbd8d17098cd289efc9a6d6b0ab48c9bd0369e124418c07c`，不是旧 run 审批重用。
- 附件 `acl-evidence-36990002049-1` 已远端归档，36,545 字节，保留至 `2026-11-01T09:40:04Z`。此处依据脱敏运行回执与附件元数据；没有声称已下载独立复核整个附件。
- 恢复风险仍为 `accept-unverified-automation-storage`、`recoveryVerified=false`。本次成功不等于恢复演练通过。
- **配置存储已启用并完成空关键词保存验收**：用户更正 Production Secret 后的新部署已绑定 `hzense.com`；真实数据库连接、运行时角色核验、配置保存和整页刷新读回已通过。保留 1 条未启用的验收配置，当前管理员运行列表为空；本次未启动采集、未调用 AI、未启用公开洞察读取。下方保留各阶段的历史记录。

### 配置存储线上验收通过（2026-10-02）

- 用户重新保存 `HZENSE_AUTOMATION_DATABASE_URL` 后，Vercel 变量清单确认其 Production Secret 更新时间已改变；没有读取或导出其值，不能反推用户具体改动了哪一项。
- 用户触发的[部署 6YuEBkfg2PW4bcDazUKfLJ96Arek](https://vercel.com/zhenghu25-6909s-projects/tech-intelligence-hub-web/6YuEBkfg2PW4bcDazUKfLJ96Arek) 已 Ready，构建 3 分 25 秒，仍为提交 `46c13ff076815c5dd3fca1df5fbbb1481dbf6805`，Production 域名列表包含 `hzense.com`。本次没有重复部署或提交代码。
- Ready 后整页刷新已登录的 `/admin/sources`，显示“配置存储已就绪：可以保存配置”。该页面成功读取 dashboard，不仅检查变量存在；依据已部署调用路径，数据库连接、认证、`assertAutomationRole` 精确权限核验及两表读取均已通过。
- 只点击一次“保存配置”，新建 `配置存储验收 2026-10-02（仅手动）`，使用已就绪的 DeepSeek 配置 r5，频率为 `manual`，关键词为空，近 2 天，最多 5 篇原文，定时执行未勾选。页面返回“配置已保存为 r1。保存配置不会启动任务。”
- 随后整页刷新，再点击“编辑”只读回看：该唯一配置仍为 r1，上述字段保持不变，列表状态为“仅手动”；“允许定时执行”和“立即运行”继续禁用，当前管理员运行列表仍为空。没有重复保存、调用 AI、触发任务或发布内容；此次创建的验收配置保留，未删除。
- 这次只验收空关键词的生产保存与持久化；非空关键词此前有本地回归覆盖，本次未再写一次生产配置。界面状态对应 `enabled=false`，服务代码对未启用配置设置 `next_run_at=null`；本次未另行执行 SQL 回查或取得原始 API JSON，不能把 UI 证据表述为独立 SQL/API 回执。
- 端到端核验将“Secret 已保存”“部署 Ready／域名绑定”和“真实存储读写”分开确认。付费执行、预算、联网采集和公开洞察读取仍不在本次启用范围。

### 密码设置及连接准备（2026-10-02）

- 新密码由用户在 Neon Console 输入并提交；用户确认后只读检查结果为 `Statement executed successfully`，没有再次执行密码语句。此结果不等于新角色已完成直连认证或运行时 ACL 核验。
- 前一阶段仅准备 Vercel 项目 `tech-intelligence-hub-web` 的 Production Secret 表单，名称为 `HZENSE_AUTOMATION_DATABASE_URL`，值由用户填写及保存。后续连接必须使用现有批准的 pooler 目标、显式端口及 `sslmode=verify-full&channel_binding=prefer`，不能直接照搬 Neon 默认参数。
- 本记录不保存密码、完整连接串或 SQL 编辑器内容；采集执行和专题公开读取继续关闭。

### Production Secret 已保存，配置格式验收阻塞（已解除的历史记录，2026-10-02）

- 用户反馈已保存后，Vercel 变量清单确认 `HZENSE_AUTOMATION_DATABASE_URL` 存在，类型 Secret，范围 Production；没有打开或导出其值。
- 用户触发的[部署 EZxBruU2x3pX2Evv7cyfwrAKDDbh](https://vercel.com/zhenghu25-6909s-projects/tech-intelligence-hub-web/EZxBruU2x3pX2Evv7cyfwrAKDDbh) 已 Ready，提交为 `46c13ff076815c5dd3fca1df5fbbb1481dbf6805`，Production 域名列表含 `hzense.com`，构建约 2 分 37 秒。本次没有重复创建部署。
- 新部署 Ready 后刷新已登录的 `https://hzense.com/admin/sources`，仍显示“配置存储尚未就绪”，保存及刷新按钮禁用。根据页面和 `automationStorageConfiguration()` 的调用路径，此状态属于连接配置解析／生产环境／批准目标校验尚未通过，尚未进入该页面的数据库认证与 ACL 校验；不能据此认定密码错误或授权缺失。
- 对脱敏 API 路径的浏览器直接导航被客户端阻止，因此没有取得 API 状态码或错误响应，不将页面提示冒充 API 回执。配置值未读取，具体不匹配字段尚未确定；需核对完整 URL（不是单独密码）、专用用户名、批准的 pooler 主机、显式端口、数据库名和两项 TLS 参数后重新部署。
- 按端到端验收的首个失败边界停止，未尝试保存验收配置、未触发运行、未轮换密码或扩展权限。本阶段未完成新角色连接认证、真实保存及刷新读回验收。

### 专用角色授权已完成（2026-10-02）

- 用户确认执行最小授权后，在同一生产 main 分支经 Neon Console 分别执行一次：`neondb/neondb_owner` 创建无密码角色，`hzense/hzense_migrator` 授予两张私表的精确列权限。两笔事务均显示 `COMMIT` 成功，授权后的事务内断言通过；没有提高迁移账号权限，也没有创建 `hzense_insight_reader`。
- 已执行文件 SHA-256：`create_automation_config_admin.sql` 为 `413696e0cbe540b85538ea6c567c29b8490a2031b68cce0ed4b55746b9573ddf`；`configure_automation_config_admin.sql` 为 `808a3d1eba3266b8cda73292c3578555c40fbaa6f35fabcc8f3f54346654d370`。控制台提示授权查询的历史会截断最后 6,631 字符，不影响本次完整执行；因此以上完整脚本及其摘要才是执行内容记录，不把截断历史当成完整 SQL 证据。
- 随后以 owner 执行独立 `REPEATABLE READ READ ONLY` 回查：角色属性契约为 true；管理关系 1 条且不安全关系 0；对象所有权 0；数据库直接 ACL 仅 `hzense/CONNECT`，Schema 直接 ACL 仅 `public/USAGE`，均不可转授；表／序列级直接 ACL 0，列级直接 ACL 共 82。
- 逐表回读恰好 6 行：`automation_configs` 为 SELECT 8／INSERT 8／UPDATE 5；`automation_runs` 为 SELECT 23／INSERT 23／UPDATE 15，所有 `is_grantable=false`，列名与审核字典一致。
- 配置表 0 条、运行表 0 条、公开洞察 reader 0 个。尚未设置密码、写 Vercel 连接或执行真实保存验收；没有调用 AI。此 owner 身份 ACL 回读不替代后续新账号直连时的完整运行时核验。

### 专用角色准备（授权前记录）

- Neon Console 在同一生产 main 分支以只读事务确认：`hzense` 的认证账号与数据库 owner 均为 `hzense_migrator`，其 `CREATEROLE=false`；0026 记录为 1，两张自动任务私表均为 0 条，`hzense_automation_admin` 与 `hzense_insight_reader` 均不存在。
- 切换至 `neondb` 后只读确认：认证账号与 owner 均为 `neondb_owner`，`CREATEROLE=true`，目标 admin 角色仍不存在。没有提升迁移账号权限。
- 本次仅准备 `create_automation_config_admin.sql` 和 `configure_automation_config_admin.sql` 两步：由 Neon 管理身份创建 `PASSWORD NULL` 的受限账号，再由实际业务数据库 owner 授予 `automation_configs` 与 `automation_runs` 的精确列权限。原双角色脚本保留，不在本次执行；不创建公开洞察 reader。
- 两步不是跨数据库原子事务；第二步若失败，保留无密码角色并核查，不自动删角色、重建或放宽权限。创建和授权尚待操作确认，新密码须由用户设置。
- 独立复审指出 `GRANT` 可能仅警告而提交，已在授权事务提交前增加有效权限和精确直接 ACL 双向比较，固定为两表共 82 项列能力；缺失、额外权限、转授权及不符的环境权限均抛错回滚。本地 7 条新增静态授权契约测试与 3 条既有 Schema 测试通过，ESLint／格式检查及最终独立复审通过，尚未在生产执行。
- 本地没有执行新 SQL 的数据库集成测试；提交前检查也不是完整运行时角色守卫的替代，系统目录额外 ACL 和 vector 完整清单仍须运行时校验。完成授权后仍需只读核验和真实保存验收。
- 同日再次检查 Vercel Production 变量清单，仍缺 `HZENSE_AUTOMATION_DATABASE_URL`；自动执行及专题公开读取变量也未设置。管理员登录后的 `/admin/sources` 明确显示“配置存储尚未就绪”、保存与刷新禁用，暂无配置或运行记录；没有尝试绕过页面门禁或调用模型。

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
