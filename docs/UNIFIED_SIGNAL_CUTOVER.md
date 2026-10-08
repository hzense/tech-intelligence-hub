# 统一 Signal 读写与生产切换

2026-10-08：生产 **0030 结构、统一数据回填、最小业务授权、独立只读核验及网站切换均已完成**（31 项迁移、62 张表；114 条 Signal、120 个版本、112 条公开）。PR #213 修复 ACL 查询路径误判，受保护正式事务重新构建并匹配已审核计划后成功提交；没有重复预演。首次网站对比发现的名称型资源链接差异由 PR #214 修复，`main@86f791a` 已部署至 `hzense.com`，Production 的统一开关为 `1`。112 条详情正文、来源、链接及 5 个核心页面与冻结基线完全一致，健康正常，PR/main CI 全通过；本次维护冻结可解除。没有试发布或付费 AI 调用，旧来源与审计仍保留，后续数据写入继续使用既有管理员确认流程。详见[完整验收记录](production-evidence/2026-10-07-unified-signal-cutover-schema.md#最终生产切换验收通过)。

## 实现边界

- `0030_unified_signal_cutover.sql` 新增默认 `ready=false` 的私有控制表、审计输入列 `unified_content`、两个触发器和两个公开视图。DDL 不回填、不授权、不启用。
- `saveEditorialSignal({ unified: true })` 保留审核事务、归属校验、请求幂等和版本锁；先登记资源，再用完整 JS 契约构造统一内容。writer 仅增加 `unified_content` 列 INSERT；owner 触发器原子写入 `signals`、`signal_versions` 和最新指针，不给业务账号核心表权限或函数执行权。SQL 校验封装、关键内容对应关系及生命周期，嵌套内容完整校验仍由应用契约负责。
- 激活后，延迟约束触发器拒绝只写旧审计表的旧应用。撤回沿用上一公开正文，不能在已发布版本上写草稿。审计表保留同事务入口，不再是公开正文权威。
- 4.0 的状态来自最新版本 `lifecycle_status`；`unified_public_signals` 只输出最新已发布版本及公开字段，`unified_public_status` 只输出就绪状态。旧 `signal_publication_state`／`current_public_signals` 保留用于 3.0，不把旧证据许可改成人工确认许可，也不 UNION 三套来源。
- `HZENSE_UNIFIED_SIGNAL_ENABLED=1` 同时切换业务写入、公开列表／详情、雷达／资源／洞察关联、搜索的 Signal 结果及后台任务 Signal 快照。未设置或 `0` 继续旧路径，非法值报错。开启后读取失败或未就绪不回退旧公开数据。
- 统一存储的人工信号 `captured_at` 仍为 `null`。页面兼容 DTO 暂仍以发布修订时间填充原显示字段，不把它写回采集时间；历史内容、ID、日期、来源、领域、评分和资源链接不改写。

## 受保护入口

`unified-signal-apply` 要求当前 main 的成功 CI、当次环境审批及 `verified` 恢复策略。批准须绑定 SHA／runId／attempt／有效期、有效备份和恢复证据、ACL 基线、维护冻结、`roleUpgradeApproved=true`、`cutoverApproved=true`，以及新 manifest／target／plan 指纹。

apply 精确核验 0000–0030（31 项迁移、62 张表），拒绝待迁移、旧审批、ACL／来源漂移和非空冲突目标。同一串行化事务里回填、逐条对账、授予新视图 SELECT 列和审计输入列 INSERT、保存就绪状态；提交前再查批准和 main，提交后使用新连接独立核验。

`unified-signal-verify` 不写入、不授权，按私有控制表绑定的计划比较来源、全部目标版本和最新公开投影。提交未知只运行 verify，不重试 apply。解除冻结后的新修订会改变原计划，因此这不是长期在线健康检查。完整私有计划仅在内存处理，公开日志只输出计数和指纹。

## 生产执行顺序

1. 合并部署代码，保持新开关关闭；核对原站列表、详情和健康。
2. 冻结发布、撤回、自动发布、数据库 DDL／授权及无关部署；建立新备份并核对恢复证据。独立受保护 `migrate` 审批应用 **0030 结构**，随后 `verify`，不能复用仅 0029 的授权。
3. 新运行 `unified-signal-dry-run`（31 项冻结清单），记录来源／计划／公开 ID 指纹及切换前网页正文、链接快照。旧 30 项预演只供历史对照。
4. 采集当前 ACL 基线，审核新增最小授权和恢复计划；建立绑定本次运行、目标、备份、ACL 和计划的 `unified-signal-apply` 审批。执行成功后另运行 `unified-signal-verify`。
5. 核验通过后，Vercel Production 设置 `HZENSE_UNIFIED_SIGNAL_ENABLED=1`，重新部署同一批准提交。核对 `hzense.com` 别名、部署 SHA、全部公开 ID／正文／来源／链接及列表、详情、雷达、资源、搜索，再解除冻结。
6. 切读失败保持发布冻结；不能只关闭应用开关后恢复写入（数据库会拒绝旧路径）。回退就绪状态／权限属于新的受保护维护，须核对新增修订；旧来源和审计表不删除。

## 验证范围

本批隔离回归使用真实 110 条冻结归档与合成人工全修订，覆盖原子撤回／再发布、请求重放、归属／版本冲突、SQL／JS 微秒来源指纹、最小 ACL、拒绝过宽权限和老应用拦截；公开契约逐条对比保留正文与链接。维护单测覆盖审批过期、漂移、提交未知及独立核验失败。

完整 PostgreSQL + pgvector 由 PR CI 核验；显式本地无 vector 测试不替代完整矩阵。生产迁移、域名实际切换及完整网页对比是独立验收项，不能用本地测试或代码 READY 代替。
