# 私有导入任务与上传处理

本增量包含批量导入阶段 2b–2e 的代码：私有存储、上传页面、Blob 直传、受控链接抓取、隔离解析及处理状态。**代码与隔离测试不等于已上线**；生产资源、迁移、专用角色与费用尚待独立审批。外部 OCR 暂时关闭，完整第二阶段仍未完成。

## 物理结构

| 表                   | 用途                                             | 身份及引用                         |
| -------------------- | ------------------------------------------------ | ---------------------------------- |
| `import_batches`     | 管理员归属、请求指纹、意图、冻结配置、取消标志   | 请求 UUID 主键；不引用公开内容     |
| `import_items`       | 输入声明、逐项状态、fencing 版本                 | UUID；关联批次；批次内位置唯一     |
| `import_documents`   | 固定原件：私有对象键、版本、实测哈希／大小／类型 | 输入项主键；改变原件须新建项       |
| `import_attempts`    | 解析器版本、租约、状态、预算                     | 输入项＋递增 fence 主键            |
| `import_outputs`     | 私有正文与页／段／单元格／区域定位               | 引用原件及具体尝试；成功结果不覆盖 |
| `import_audit`       | 创建、接收、领取、结束、取消及重试事件           | UUID；关联批次及可选项；不记录正文 |
| `import_daily_usage` | UTC 日全局预留与保守计费                         | 日期主键；无损 bigint              |

精确物理定义为 `db/migrations/0014_import_tasks.sql`、`packages/database/src/import-schema.ts` 和独立 `import-catalog.mjs`；`verify.mjs` 核对字段、默认值、主外键、检查及索引。新代码期望 **15 迁移／47 表**，不代表生产现状。

迁移只创建 owner-only 私表，拒绝继承其他角色默认授权，不创建角色或授予现有应用角色权限。不修改 `sources`、Signal seal、公开投影或读模式。

## 存储接口与边界

实现位于 `packages/database/src/import-store.mjs`。

- 创建：服务端提供实际能力；批次 UUID＋规范输入指纹幂等。同 ID 不同内容／归属冲突；每日每管理员最多 100 批。批次、输入项和创建审计同事务提交。
- 接收确认：仅供受信存储适配器使用，浏览器声明不能直接作为实测值。对象键绑定批次／项，重复确认须版本、哈希、大小和格式完全相同；文件确认后才入队。
- 领取：短事务预留预算并创建 7 分钟租约（覆盖 240 秒请求上限与最迟启动的 120 秒 Sandbox）；网络与解析在事务外执行。同项只有一个并发领取成功，最多 5 次尝试。
- 完成：必须匹配有效 fence 和租约；输出最多 10000 片段、每片段 20000 字符、正文累计 1 MB（UTF-8）、页码不超过 300。输出恒为私有。
- 超时：免费工作转失败，付费工作转未知；未知结果禁止直接重试并保留保守费用。旧 Worker 不能覆盖新尝试。
- 取消：失效未完成任务，不删除成功输出或原件，不撤回已发表 Signal。在途费用预留保持占用，后续需对账。
- 查询：按管理员归属隔离；返回私有 DTO，每页 50 批，通过归属校验的批次游标向前／向后翻页，保留数据库时间戳精度。HTTP 层独立验证 Google 管理员会话、固定站点 Origin、写入同源、实际 JSON 大小与读取期限，并返回 `no-store`／`noindex`。存储模块本身不是 HTTP 安全边界。

`generate_publish` 仅记录后续意图，不触发 AI，不授予发布资格，不写公开表。数据库 owner 属于受信维护主体；专用服务角色必须单独审批配置，原件／输出／审计只允许 INSERT、SELECT。`import-role.mjs` 在每次获取生产连接时核验角色属性、成员关系和有效 ACL；不能借用 Migrator、AI Admin、Publisher 或 Signal Reader。

## 页面与处理入口

- `/admin/imports`：逐页面鉴权；多文件、逐行链接、整批预检、幂等创建、续传当前批次、逐项确认／处理／重试／超时核对／取消、私有解析结果。刷新后已上传对象可重新确认；尚未上传文件需重新选取。当前页面不包含 AI 生成或发布按钮。
- `/api/admin/imports`：按会话主体隔离的查询与命令；不能从客户端指定 owner、实测哈希或处理结果。
- `/api/admin/imports/upload`：仅签发五分钟、固定私有路径、禁止覆盖的直传令牌。浏览器声明只确定大小上限，不作为接收证明。
- `/api/imports/blob`：仅接受 SDK 签名验证后的完成回调；服务端按固定对象键读取，核对实际字节、大小、版本、SHA-256。回调中的 URL 不作为读取目标；浏览器可通过受保护确认接口修复回调丢失。
- `/api/imports/worker`：独立服务令牌保护的 **POST** 扫描入口，一次领取一个持久化任务；没有自动创建定时计划。授权配置调度器后，关闭浏览器也可继续处理。当前也可由管理员逐项点击处理。

运行状态在 Neon，不依赖网页进程内队列。任务领取在全局锁下限制有效 `running`／`cancelled`／`unknown` 尝试租约总数为一；取消或停止结果不确定时，不能证明已经启动的计算消失，因此继续占用容量直到原租约到期（最多七分钟），Sandbox 最长 120 秒自动停止。取消保留费用，旧结果受 fence 拒绝。解析代码和批准镜像 ID 的哈希冻结为批次版本；镜像升级后旧队列不会静默使用新配置。

## 实际解析与网络边界

队列在截取前排除解析器版本不匹配、已达尝试上限或批次余额不足的等待项，避免旧任务长期挡住新批次；过期运行项仍可进入超时核对。第五次失败后页面不再提供重试，接口统一返回 `retry_not_allowed`（HTTP 409），不误报临时服务故障。

`import-fetch.ts` 对每跳 HTTPS URL 检查 DNS 全部地址，拒绝私网／保留地址，固定 TLS 实际连接的解析结果；不传浏览器 Cookie、Authorization 或 AI 密钥。最多三次重定向、每跳 15 秒、实际响应 25 MiB，拒绝压缩响应及未支持 MIME。批次原件登记总量不超过 200 MiB（超限对象可能成为待清理孤儿，不隐式覆盖）。

`import-parser-source.mjs` 在批准的干净 Sandbox 镜像中运行：`persistent:false`、`networkPolicy:deny-all`，只写入单份原件和解析源码，不注入数据库／AI 凭据，不在接收文档后联网安装依赖。镜像需 Python 3.11+ 和固定 `parser-requirements.txt`（pypdf 6.18.1）。运行时 CPU、内存、文件大小、ZIP 展开体积／压缩比、XML 实体、页数及输出片段均有限制。

支持 UTF-8 TXT／Markdown／HTML／CSV、DOCX、XLSX、文本型 PDF；保留页、段、工作表与单元格定位。公式不执行，仅读缓存值并标记警告；HTML 不渲染脚本。PDF 任一页无可提取文本即拒绝并要求 OCR（包括空白页，保守失败），图片不进入处理队列。原件类型声明与文本型／ZIP／PDF 实际内容不符时失败，不把空结果当成功。

## 生产配置（尚未执行）

| 配置                                 | 用途                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `HZENSE_IMPORT_ENABLED=1`            | 完成审批与验收后才开启，Preview 禁用                                                                   |
| `HZENSE_IMPORT_DATABASE_URL`         | 专用 `hzense_import_admin` Neon pooled TLS DSN；沿用 `HZENSE_RUNTIME_EXPECTED_HOST/PORT/NAME` 目标核对 |
| `HZENSE_IMPORT_BLOB_TOKEN`           | 仅专用私有 Blob Store 的服务端令牌                                                                     |
| `HZENSE_IMPORT_PARSER_SNAPSHOT_ID`   | 无凭据、预装固定解析依赖的批准镜像                                                                     |
| `HZENSE_IMPORT_RESERVE_MICROUSD`     | 每次领取的保守费用预留，正整数                                                                         |
| `HZENSE_IMPORT_DAILY_LIMIT_MICROUSD` | UTC 日应用预算，正整数                                                                                 |
| `HZENSE_IMPORT_BATCH_LIMIT_MICROUSD` | 创建时冻结的批次预算，正整数                                                                           |
| `HZENSE_IMPORT_WORKER_TOKEN`         | 至少 32 字符随机服务令牌，调度器以 Bearer 提交 POST                                                    |

Sandbox 使用 Vercel 运行环境的服务认证；上述配置只能放在服务端 Production Secret，不填入文档或浏览器表单。预算是应用侧保守预留，不冒称 Vercel 实际账单或平台硬支出上限；Blob 存储与网络费用须另行评估。未知结果禁止重试，待人工对账。

专用角色要求 `LOGIN NOINHERIT CONNECTION LIMIT 2`、无高权限和角色／数据库设置、无应用 schema CREATE、数据库 CREATE/TEMP、其它业务表／列／序列／非扩展函数权限。成员关系检查双向拒绝，仅保留既有 Neon 规则允许的精确管理边：cloud_admin 授予 neondb_owner 对目标角色的 ADMIN-only，且 INHERIT／SET 均为 false。仅七张导入私表 SELECT、INSERT，其中 `import_batches/items/attempts/daily_usage` 可 UPDATE；原件、结果、审计禁止 UPDATE／DELETE，也拒绝 MAINTAIN 等额外能力。生产授权需先核验现有公共权限和完整 Schema，拒绝隐式修复 PUBLIC 或复用旧审批。

## 仍待交付与审批

1. 新资源的地区、保留期限、平台费用上限与生产开通；`0014` 迁移和最小授权独立审批。
2. 使用真实私有 Blob／Sandbox／Neon 的端到端验收，线上调度器配置与超时故障演练。SDK 适配代码不等于云资源已验证可用。
3. 外部 OCR：本次明确关闭，不上传扫描件给第三方；全格式第二阶段不能标为完成。
4. 未知费用对账操作、孤儿清理、保留策略和跨浏览器未上传文件续传体验。
5. 后续 AI 提取、独立核验、人物关联与合格发布。这些属于第三阶段，不被解析完成替代。

已按“继续完成”续接 Neon＋私有 Blob＋隔离 Worker 技术组合。资源、地区、保留期限与预算数值仍须审批。本轮不创建生产资源、不执行 `0014`、不保存 Secret、不传输真实文档或调用外部 OCR。

旧 `accept-unverified-ai-config` 审批仅覆盖 `0000–0013`，不得复用于导入迁移。回归明确检查新 artifact 被旧门禁拒绝，没有扩大旧审批。

## 验证

`import-schema.test.ts` 核对独立物理契约；`import-store.integration.test.mjs` 在隔离 PostgreSQL 检查并发幂等、归属、原件固定、fencing、取消、超时、预算及默认权限泄漏。新增 `import-role.integration.test.mjs` 以专用角色验证合法操作及越权拒绝，不冒称生产 ACL 验收。

`import-parser.test.mjs` 实际解析七类合成文件，包括 PDF 扫描页拒绝、页数限制、XLSX 缓存公式、XML 实体拒绝。`admin-import.test.mjs`／`import-worker.test.mjs` 检查鉴权、流读取边界、受控抓取和 Worker 状态提交；网络与 Worker 使用替身，不是实测云平台。`admin-import-browser.test.mjs` 用实际组件和合成 HTTP 服务验证桌面／移动端流程；真实 Next.js 构建路由的匿名访问已验证重定向至登录页。

2026-09-15 本地隔离验证：数据库默认测试 1776 项通过（531 项原生测试在默认命令中跳过，随后独立原生测试命令全部通过）；完整原生 PostgreSQL 531 项通过；导入包 33 项通过。数据库／导入包 lint、类型检查和改动文件格式检查通过。导入专属测试为 10 项原生行为测试＋2 项物理契约测试。尚未提交 PR、进行远端 CI、合并或部署。

2026-09-15 续接验证：完整原生 PostgreSQL **535** 项通过（新增专用角色 3 项和输出归属 1 项）；Web 默认 **381** 项通过、6 项受环境开关保护的测试跳过，新增导入浏览器测试另行开启并通过；导入包 **39** 项通过，包括指定 Python 环境的真实 PDF 样例。Blob SDK 的令牌约束／回调签名契约在无网络、合成令牌条件下通过。全仓 lint、类型检查、格式、工作流校验、生产依赖审计与 Web 生产构建通过。上述全部是本地／隔离验证，不是云端上线证据。PR、远端 CI、合并与生产发布另行记录。

[PR #91](https://github.com/hzense/tech-intelligence-hub/pull/91) 后续修复：首次 CI 仅因新隔离角色缺少 SCRAM 密码失败，已改为一次性测试凭据并复测；评审要求的传入角色关系与取消任务容量保留均已修复。完整原生回归增至 **536** 项，`0244afc` 的 [CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34986606110) 三个门禁全部通过，预览部署成功。代码交付与生产启用仍分开，未执行真实迁移或创建云资源。
