# 2026-09-15 私有导入生产准备

## 范围与状态

操作者授权创建导入资源，并指定单批 10 美元、每日 50 美元、原件保留 7 天。导入基础代码 [PR #91](https://github.com/hzense/tech-intelligence-hub/pull/91)、保留策略 [PR #92](https://github.com/hzense/tech-intelligence-hub/pull/92)、独立迁移门禁 [PR #93](https://github.com/hzense/tech-intelligence-hub/pull/93) 已合并。2026-09-15 已核验 main `630610fa93faf400442eaa8991ac32d3ddb8d902` 的 [CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34998673977) 成功，Production 部署 `dpl_FpvNsqkXriA47cizBkYFyk3VMESA` READY；这不代表导入已启用。

**最新状态（2026-09-16）：生产导入及每小时原件清理已开启。** TXT 和 PDF/DOCX/Markdown/HTTPS 混合批次的受控验收通过，清理预演与正式运行均成功、实际删除 0。详细证据见文末；下文较早的“关闭／待验收”描述是历史状态，不再代表当前开关。没有调用 AI、OCR，没有写公开 Signal、发布或搜索投影，也不声称恢复演练完成。

## 已完成的资源与只读核验

- Vercel 专用私有 Blob Store `hzense-import-originals`，地区 `iad1`，仅关联 Production。专用令牌已保存至 Vercel Production 和当前仓库的加密 Secret，未记录令牌值。
- Production 保存了单批 `10000000`、每日 `50000000`、单次预留 `100000` microUSD；保留天数为 7，Store ID 固定核对，`HZENSE_IMPORT_ENABLED=0`。应用预留不是 Vercel 账单或平台硬支出上限，存储和网络另计。
- 干净解析镜像 `snap_gVYmKWCJ1bUAuziDgRykqW0aiVjx` 已创建。独立断网冷启动验证 Python 3.11+ 与 pypdf 6.18.1 成功，验证实例已停止。镜像不包含用户文档或注入的应用密钥；镜像不设到期时间，与原件 7 天政策分开。
- Neon 备份分支 `pre-import-0014-20260915`（`br-summer-rice-av63302k`）从 main 的当前数据与 Schema 创建。创建时间 `2026-09-15T16:17:09Z`，到期 `2026-09-22T16:17:09Z`。只确认存在，未验证恢复能力。
- 受保护只读预检 [34993635520](https://github.com/hzense/tech-intelligence-hub/actions/runs/34993635520) 经操作者审批后，于 `2026-09-15T16:18:27Z` 成功完成。脱敏结果 `pendingMigrationCount=1`；对应待执行 `0014_import_tasks.sql`。预检未迁移或授权。
- GitHub 已保存清理专用 Secret 和 Store ID；`HZENSE_IMPORT_RETENTION_ENABLED=0`，没有执行真实删除。
- Production 解析镜像 ID 与随机 Worker 服务令牌已保存。平台 API 确认所有新配置为 Production-only Sensitive 类型；CLI 回读为空是保密行为，不能据此推断变量为空，也没有降低敏感等级。真实 Store 空扫描使用同一专用 Store 的原始集成令牌，结果为 `scanned=0, eligible=0, deleted=0`；尚未验证部署运行时读取全部 Sensitive 配置。

## 本地与隔离回归

本轮 Web 默认测试 390 项通过、6 项环境测试跳过；单独开启导入实际组件浏览器测试，桌面／移动端 1 项通过。原生 PostgreSQL 导入存储及角色隔离 18 项通过；导入包 41 项通过，包含真实合成 PDF 解析。Web 生产构建、类型检查，Web／数据库／导入包 lint 与工作流验证通过。这些不代替云端全链路验收。

## 仍未完成

### 2026-09-16 迁移已提交，完整核验已通过

- [预检 34999035044](https://github.com/hzense/tech-intelligence-hub/actions/runs/34999035044) 成功，只有 0014 待迁移，目标和备份绑定与批准计划一致。
- [ACL 采集 35069259800](https://github.com/hzense/tech-intelligence-hub/actions/runs/35069259800) 成功，两次独立指纹相同：`2165a195f946fda0f0e1fc85e5abe4b6b42ed4d20edeae8f98e0188fb97bda5a`；脱敏制品 `acl-evidence-35069259800-1` 已归档。恢复能力仍为 `recoveryVerified=false`。
- [迁移 35070299513](https://github.com/hzense/tech-intelligence-hub/actions/runs/35070299513) 工作流结果为失败，公开错误仅为 `database-or-contract-check-failed`。随后 Neon main/hzense 的只读账本查询确认：**0014 已于 `2026-09-16T07:49:59.714336Z` 提交**；迁移记录 15 条，7 张导入表存在，0014 checksum 为 `ae84c8eb9c212c48bde256eda199238f8d43579f2caa969b76fcc248709eda8a`。
- 明确发现迁移后校验冲突：既有 `configure_signal_admin_reader.sql` 允许只读角色执行 `hzense_public_signal_is_current(uuid)`，实际 ACL 也有该非转授权 EXECUTE，但 `current-publication-catalog.mjs` 未列入该角色。修复仅同步这一函数的可接受授权名单，不修改函数、迁移 SQL 或生产 ACL。
- 新增目录级正负回归，以及实际执行正式角色授权脚本后的完整 `verifyDatabaseContract` 回归。撤回此名单修复时两项测试均复现同一函数契约错误；恢复修复后通过。必须在合并后单独执行生产 **`verify`**，不能重跑 `migrate`；尚不声称完整生产核验或导入上线完成。
- PR #94 评审进一步要求不能仅信任角色名。完整核验在发现该专用角色存在时，于只读事务中复用正式授权脚本的独立 post-GRANT 断言块（不执行授权段或 COMMIT），检查角色属性、双向成员关系、所有权、跨库边界和完整有效／直接 ACL。原生回归覆盖角色属性、双向成员、额外原文列、缺失必要列及撤销必需 EXECUTE 的漂移，均拒绝；仅角色不存在时允许尚未配置 reader，空角色或部分授权状态不能跳过。

后续授权更新：操作者已明确回复“确认接受”，接受该新备份未验证恢复能力的风险，仅限 `0014` 迁移和导入角色最小授权。浏览器再次核对备份分支仍存在、父分支为 main、到期为 `2026-09-22T16:17:09Z`。此授权不是迁移或权限授予成功证明。

后续核验：PR #94 已合并为 `f8ff4df90aa4683bccb76debf59495be8c944161`，main CI [35073192941](https://github.com/hzense/tech-intelligence-hub/actions/runs/35073192941) 成功。操作者批准独立只读 [verify 35073482849](https://github.com/hzense/tech-intelligence-hub/actions/runs/35073482849) 后，于 `2026-09-16T09:20:30Z` 返回 `operation=verify,status=succeeded,migrationCount=15,tableCount=47`；没有重跑迁移或变更 ACL。

### 2026-09-16 导入凭据配置准备

按“开始配置”续接：Neon 页面只读确认生产 main/hzense 的 15 条迁移和 7 张导入表，`hzense_import_admin` 不存在；main/neondb 的实际登录为具有 CREATEROLE 的非超级用户 `neondb_owner`。Vercel API 只读取变量元数据，已有导入配置均为 Production-only Sensitive，尚无 `HZENSE_IMPORT_DATABASE_URL`。

新增 `db/roles/create_import_admin.sql` 为凭据创建候选，复用既有受审 AI 凭据流程，仅替换目标角色及标签，并添加模板一致性测试。它只允许创建不存在的受限登录，拒绝覆盖现有密码，不附带导入表授权。浏览器已准备语句，但**尚未提交**：新凭据必须由管理员在页面执行并保管结果，确认 COMMIT 成功后才能使用。数据库分支必须由页面独立核对。不要把密码、连接串或结果截图提交到聊天或仓库。

随后操作者回复“已创建”。独立页面在 main/hzense 以 `hzense_migrator` 只读确认 `hzense_import_admin` 已存在：LOGIN=true、INHERIT=false、连接上限 2，五项高权限均 false；所有权／直接 ACL 依赖为 0、角色设置为 0，仅有 cloud_admin 授予 neondb_owner 的 ADMIN-only 管理边（INHERIT/SET=false）。未读取原密码结果页，未验证密码或实际服务登录。新增 `configure_import_admin.sql` 并以隔离原生 PostgreSQL 验证精确权限、重复授权拒绝、checksum／角色／PUBLIC 漂移拒绝及提交前 DELETE 注入回滚；生产授权仍待独立执行确认，Production DSN 尚未保存。

操作者随后回复“已经保存”，平台元数据确认 `HZENSE_IMPORT_DATABASE_URL` 已设置为仅 Production 的 Sensitive 变量。没有读取其值，尚未验证真实服务认证或部署运行时；导入开关仍为 0。PR #95 评审要求收紧整表授权，已改为固定列级 SELECT／INSERT／UPDATE 白名单并同步运行时核验：不可更新 owner_id、configuration、batch_id、declaration、尝试身份、parser_version、lease_until、预算归属或原始预留，未来新增列不继承权限。隔离 PostgreSQL 的 18 项定向测试通过，包括实际服务身份完成创建、原件确认、claim、预算结算、输出及取消，以及表级／不可变列授权注入整笔回滚。该测试不代表生产已授权，生产授权仍待执行时确认。

复审进一步指出 `SELECT *`／`RETURNING *` 与未来列隔离不兼容，存储查询现已复用固定 SELECT 列清单（含关联查询别名前缀）。增加七张表均有未授权新增列时的实际服务流程与列表／详情回归，既不返回新字段，也不因新字段缺少权限而中断。最新定向测试 20 项及存储集成测试 15 项通过；仍未执行生产授权。

再次复审要求同时拒绝显式默认 ACL 中的 PUBLIC 与目标角色授权，已加入授权前、提交前及运行时核验；发现该状态即拒绝，不替管理员调整默认权限。新增表／序列／函数的 PUBLIC 默认授权漂移与注入回滚回归，定向测试增至 26 项通过。此检查针对 `pg_default_acl` 中的显式规则，不替代未来 DDL 的权限审核。

### 2026-09-16 生产导入角色最小授权完成

PR [#95](https://github.com/hzense/tech-intelligence-hub/pull/95) 已完成复审并合并为 `97a94924552e6da8ff5faecc778d44500230c195`，主分支 CI [35083660520](https://github.com/hzense/tech-intelligence-hub/actions/runs/35083660520) 成功，生产部署已 READY。本段仅记录随后独立执行的数据库授权，不代表导入功能已经启用。

操作者在执行前回复“确认允许”，同意 main/hzense 的固定列级最小授权，并在核验完成前暂停其他生产 DDL、授权和发布。浏览器只读预检确认实际数据库为 hzense、session_user 与数据库 owner 均为 hzense_migrator、迁移数 15，目标角色既有所有权／ACL 依赖及不安全显式默认 ACL 均为 0。

随后执行上述提交的 `db/roles/configure_import_admin.sql`，文件 SHA-256 为 `629482f46e9e24a07fcd976a25b7d97b0350cd37f7623572e6ecc44e4cd462a2`，长度 18173 字节。Neon 返回 14 条语句成功（BEGIN、两项 SET、前置 DO、八项 GRANT、提交前 DO、COMMIT），连接恢复为非事务状态。页面提示仅查询历史会截断末尾 9173 字符；完整输入已执行，**不得从截断历史重新运行授权**，正式脚本以代码仓为准。

独立提交后查询在 `2026-09-16T11:09:40.76031Z` 返回：

| 项目                                               | 结果                                                 |
| -------------------------------------------------- | ---------------------------------------------------- |
| 核验会话                                           | hzense / hzense_migrator（owner 会话，不是服务登录） |
| 直接列授权数／覆盖的导入私表数                     | 88 / 7                                               |
| 不安全列授权数（转授权、非 owner 授予、非 public） | 0                                                    |
| 直接整表授权／直接函数授权                         | 0 / 0                                                |
| PUBLIC 或目标角色的显式默认授权                    | 0                                                    |
| 当前库 CONNECT／public USAGE                       | true / true                                          |

授权事务内的完整校验同时覆盖列白名单、有效权限、角色属性、成员关系及跨库边界。没有修改密码、PUBLIC 或其他角色权限，没有写入导入业务数据；0014 未重跑。该次授权维护窗口现已结束。`HZENSE_IMPORT_ENABLED=0`、保留清理、AI/OCR 与自动发布均未开启；Vercel 中敏感 DSN 的真实认证、受控合成文件端到端验收及后台处理调度仍待完成。

操作者进一步确认维护期间没有其他生产 DDL、角色授权或发布并行操作。PR #93 复审发现目标绑定缺口，已将数据库目标与备份哈希纳入 v2 计划，增加 ACL 采集前及实际迁移连接锁内检查；当时尚未执行生产 DDL，后续执行结果见上文。

1. 完整 Schema 的独立 `verify` 已通过；0014 已提交，不重复执行迁移。
2. 专用 `hzense_import_admin` 的最小 ACL 已提交并复核，Production DSN 已保存；仍需验证该 DSN 的真实服务登录与运行时权限。
3. 保留策略代码已合并部署，真实 Store 空扫描后才开启云端清理。
4. 资源配置后的部署和受控合成文件端到端验收，最后开启导入。后台持续处理调度尚未配置。

原件满 7 天拒绝读取；物理删除由每小时任务执行，存在调度或故障延迟。私有解析结果与审计仍保留。没有上传真实用户文档，也未创建外部 OCR 资源。

### 2026-09-16 受控验收：配置校验仍阻塞

操作者明确允许临时开启 Production 导入开关、重新部署并使用合成 TXT 验证上传及解析，随后关闭并重新部署；不调用 AI、不发布信号、不启用自动任务。

- 将 `HZENSE_IMPORT_ENABLED` 临时设置为 `1` 后，部署 `dpl_gTDzHpFpWWQWdFwxkx3QfVtxFRdG` 达到 READY，`hzense.com` 已指向该部署；代码仍为 `97a94924552e6da8ff5faecc778d44500230c195`。
- 浏览器 Google 管理员登录成功，但 `/admin/imports` 仍显示“生产导入尚未配置”，上传、创建及刷新控件禁用。按照首个失败边界停止验收，未上传合成文件、未创建导入批次、未调用解析或 AI。
- 平台元数据确认导入及预期数据库目标的必需变量名称均存在且范围为 Production；未读取敏感变量值。名称存在不代表内容校验通过，Vercel 的真实 DSN 认证和运行时 ACL 仍未验证。
- `importConfig()` 会将 Blob Store 绑定、数据库 URL、保留期及预算等错误统一折叠为 `not_configured`；共享数据库校验明确要求 `sslmode=verify-full` 和 `channel_binding=prefer`。这是后续排查项，不能由当前统一错误断言某个具体字段错误。
- 验收部署近 15 分钟错误级日志仅返回两条 Google 登录路径的 Node `DEP0169` 弃用警告（HTTP 200/302），没有提供导入配置失败的具体原因。
- 已将 Production 开关恢复为 `0`，恢复部署 `dpl_EpQRnLGyeRQzgTJ8nXW2b4ayAiAs` 已 READY；平台确认 `hzense.com` 指向该部署，浏览器刷新后导入入口仍禁用。此次临时开启窗口已经结束。

下一步应补充不输出任何密钥或完整连接串的配置诊断，明确具体失败项后修正，再单独进行受控端到端验收。没有扩大角色授权或重跑迁移。

### 2026-09-16 脱敏配置诊断开发

新增纯函数配置检查，供服务端业务门禁与管理员诊断共用。诊断独立区分 `enabled`、`valid`、`ready`，开关关闭时仍检查配置，不连接数据库或外部服务；所有错误均映射为固定白名单代码和静态说明，原始异常、环境值和密钥不返回浏览器。页面先完成管理员认证再检查，不新增匿名诊断接口。

文档补齐显式端口和 `sslmode=verify-full&channel_binding=prefer` 的连接模板，不自动补写或降级 TLS。新增 5 项诊断测试通过；导入定向测试合计 34 项通过、1 项浏览器集成测试因未启用对应测试环境跳过，web lint/typecheck 通过。这些测试均不代表生产配置已经修正。

操作者已允许自动提交 PR、等待 CI、合并及部署诊断页；生产开关保持关闭，不更改密码或数据库权限。线上具体失败项及配置更正仍须以诊断部署后的实际结果为准。

### 2026-09-16 再次受控验收：真实读取通过，上传被浏览器权限阻塞

- 操作者修正 Production 配置后，管理员页面实际显示“配置校验：通过”。本次按既定范围临时开启导入，不调用 AI/OCR、不发布信号、不启用自动任务，预算和原件保留策略不变。
- 验收部署 `dpl_CDnmfA17WvMPCBTBA43qtoPqsK2k`（代码 `08aaf26bc181a472c4347d5b03321eb72a030e9b`）READY，平台确认 `hzense.com` 指向该部署；浏览器显示“导入开关：开启”。
- 管理员点击“刷新任务状态”后显示“状态已刷新。”，列表为空。此 GET 路径经真实 `importPool.connect()`、`assertImportRole()` 和只读批次查询，因此确认服务凭证连接、运行时角色检查及当前管理员批次列表读取通过；不代表创建/更新业务写入、Blob 或解析已通过。
- 选择无敏感信息的合成 TXT 时，Chrome 扩展在 `fileChooser.setFiles` 阶段拒绝操作（`Not allowed`）。停在浏览器本地文件访问权限边界：没有点击“创建并上传”，未创建批次、未上传原件、未执行隔离解析。
- 验收部署近 10 分钟错误级运行日志查询未返回日志；此结果不能证明所有运行路径无错误。没有变更数据库 ACL、密码或迁移。
- Production 开关已保存回 `0`，关闭部署 `dpl_3fTdvkcULT59grWBLyZSaQtpmkpu` 已 READY 并绑定 `hzense.com`；浏览器刷新确认“导入开关：关闭”、配置仍通过、上传及创建控件禁用。临时窗口已结束。后续需先允许 Chrome 扩展访问文件网址，再重新安排同范围上传解析验收。

### 2026-09-16 合成 TXT 全链路验收通过

操作者开启 Chrome 扩展文件访问权限后，本次继续同范围受控验收；没有修改数据库权限、密码或迁移，没有调用 AI/OCR、生成或发布 Signal，也没有启用自动处理或原件清理任务。

- 验收部署 `dpl_kYSErDViw9StpVutU4ti6JEznxCn` READY 并绑定 `hzense.com`，沿用代码 `08aaf26bc181a472c4347d5b03321eb72a030e9b`。页面确认导入开启、配置通过。
- 成功选择单个合成 TXT，意图为“仅预览解析结果”；创建批次 `6a013950-7dbb-41a9-8561-c5ecc354d868`。页面显示“原件已接收”，项目进入“等待处理”，验证真实批次写入、私有 Blob 上传及服务端原件确认路径。
- 仅点击一次“处理（使用已配置预算）”，状态变为“解析完成”。点击“查看私有解析结果”后成功回显：`classification=private`、`warnings=[]`、1 个片段、`locator.paragraph=1`；完整正文包含测试标记 `HZENSE-IMPORT-ACCEPTANCE-20260916-A`，与原始合成文本一致。
- 此路径验证了生产中的隔离解析调用、结果持久化及管理员结果读取；只覆盖 TXT 样本，不扩大为 PDF/DOCX/表格/链接、并发/重试/取消或到期删除均已验收的结论。应用预算仍为单批 10 美元、每日 50 美元；没有读取平台最终账单，不能将预算预留当作实际费用。
- 在临时开启窗口内，未携带登录凭证的 `GET /api/admin/imports` 返回 HTTP 401。验收部署近 10 分钟错误级日志查询未返回日志；未核验日志 Drains 或完整监控覆盖。
- 测试批次、私有合成原件和解析/审计数据保留，没有执行删除。7 天到期拒绝读取与物理删除不同：定时清理仍关闭，不能承诺到期自动删除已经生效。
- Production 导入开关已保存回 `0`，恢复部署 `dpl_HdbSjjFzpjwSLao3gM6B2oPGmwxd` 已 READY 并绑定 `hzense.com`。浏览器刷新确认导入关闭、配置校验仍通过、上传/创建/刷新控件禁用。此次临时验收窗口已结束，TXT 链路通过不等于正式开启生产导入。

### 2026-09-16 混合批次验收与正式启用

操作者要求执行记录归档、常用入口验收、原件清理启用和生产导入开启，并明确允许 PR #98 在 CI 与代码检查通过后自动合并。

- [PR #98](https://github.com/hzense/tech-intelligence-hub/pull/98) 已合并，本地同步 main `cfdfe2355fe78305ef696aaf5a7c849f02774c88`。[PR CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/35120071826) 与 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/35120503119) 全部通过。此次检查是 agent 对实际差异的检查，不是独立人工评审；合并时没有外部评审意见。
- PR #98 同时修复预演门禁：清理关闭时允许手动 `dry-run`，避免预演前开启定时删除。`apply` 仍要求显式开关，当前 main、成功 CI、专用 Store、固定路径与七天期限检查均保留；定向 8 项测试、工作流校验与 ESLint 通过。
- 单个混合批次 `cb7877df-d8b8-492a-b5b8-e1857c5c3e01` 接收三个合成文件及 `https://example.com/`。PDF、DOCX、Markdown、HTTPS 网页各处理一次，全部完成并逐项回读，均为 `classification=private`、`warnings=[]`：PDF 1 个片段定位到第 1 页；DOCX 和 Markdown 各 3 个片段，测试标记与段落定位正确；网页 4 个片段包含 Example Domain 正文。
- 只读预演 [35121009554](https://github.com/hzense/tech-intelligence-hub/actions/runs/35121009554) 在 `HZENSE_IMPORT_RETENTION_ENABLED=0` 时成功：`mode=dry-run, retentionDays=7, scanned=5, eligible=0, deleted=0`。
- 随后设置仓库清理开关为 `1`；正式运行 [35121089709](https://github.com/hzense/tech-intelligence-hub/actions/runs/35121089709) 成功：`mode=apply, retentionDays=7, scanned=5, eligible=0, deleted=0`。工作流为 active、配置每小时第 23 分钟运行；这证明首次运行成功，不证明未来调度无延迟，也没有验证过期原件实际删除。
- Production `HZENSE_IMPORT_ENABLED=1`。合并后的部署 `dpl_5b1BDmNs93ETTAkfK2CUm4VJFsp5`（main `cfdfe23`）READY；平台确认 `hzense.com` 指向该部署。浏览器重新加载后显示导入开启、配置通过，并能读取两个已完成批次；匿名 `GET /api/admin/imports` 仍返回 HTTP 401。该部署近 10 分钟错误级日志查询未返回日志；未核验 Drains 或完整监控覆盖。
- 所有五个测试原件保留，未执行实际删除。应用预算仍为单批 10 美元、UTC 日 50 美元，原件读取截止为 7 天；平台实际费用、存储与网络费用没有在本轮核算。解析结果与审计不受原件清理影响。
- 本轮正式开启的是管理员上传/链接接收、手动隔离解析和私有结果读取。AI 生成、自动发布、外部 OCR、持续处理调度未启用；CSV/XLSX、扫描件、复杂文档、最大批量、重试/取消/并发及真实到期删除尚未完成生产验收。
