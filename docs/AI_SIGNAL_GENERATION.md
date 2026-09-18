# AI 信号候选生成

## 本轮范围

2026-09-17 增量接通“已完成的私有解析结果 → 当前 Profile 提取模型 → 持久化私有候选 → 后台查看”。入口为 `/admin/signal-generation`。这是第三阶段的 **3a 私有候选提取**，不是完整的 AI 事实核验或自动发布；不改变产品最终 `auto_publish` 默认策略。

本轮代码不会写入正式 Signal、Person、Evidence、核验批准记录或公开投影，不会切换公开网站的数据源。模型名称、人物角色、日期和断言仍是待核验建议；引用逐字匹配仅证明原文中存在这些文字，不证明断言成立。需要至少一位有证据的关键人物是公开资格要求，不是让模型凑人名的理由。

## 使用流程

1. 在批量导入页上传或接收链接，并完成解析。
2. 在候选生成页选择已完成的输入和当前就绪的 Profile。页面展示接收资料的供应商域名。
3. 明确同意把所选私有解析正文发送给该供应商并产生费用，创建任务。此步骤不调用模型。
4. 显式执行任务，服务端先提交租约和预算预留，再进行一次模型调用。
5. 查看持久化候选、原文短引、事件日期、人物与组织建议及缺口。结果仅管理员可见，不代表发表。

页面刷新只恢复原任务，不自动生成。相同输入、解析版本、Profile 修订和生成版本不会因换 UUID 再次调用；失败和结果未知也不会自动重试。未知任务须人工核对，不能用删除会话存储或换编号“恢复”。当前只有手动执行，没有新增周期调度。

## 输入与输出契约

- 来源只从归属当前管理员、未取消且解析完成的导入记录读取；浏览器不能提供正文、凭据、模型参数或 owner。
- 服务端固定 `fragment-1…N` 编号并保留页／段／单元格定位，来源 JSON 的 UTF-8 上限 48000 字节。超过限制明确拒绝，暂不切片或静默截断。
- 一次最多 5 个候选，允许零候选并说明原因。日期为真实 `YYYY-MM-DD` 或 `null`，不使用上传时间；未知日期须无日期证据。人物可以为空，不推断 CEO 参与。
- 每个核心主张与人物关联包含已有片段编号及逐字短引；不存在的片段、虚构引文、额外 `verified`／发布状态等字段均拒绝。
- 服务端结果固定 `classification=private`、候选 `status=needs_review`，始终带 `needs_public_evidence`；缺人、缺事件日期分别增加 `needs_person_evidence`、`needs_event_time`。此处 `needs_review` 是内部待核验状态，不是将人工审核设为所有未来入口的必经默认。
- 只调用提取阶段，无联网工具／执行代码／发布工具。来源中的“系统提示”和指令均作为不可信正文处理。Profile 能力测试不能代替事实核验。

## 任务、预算与安全边界

追加 `0015_signal_generation.sql`，仅新增私有 `signal_generation_runs`。保存来源哈希、解析 fence、脱敏 Profile／连接修订快照、提示词、任务状态、租约、估算费用、用量和规范化结果；不保存 API key、密文凭据、完整供应商响应或异常堆栈。

新建使用请求 UUID 和语义指纹双重幂等；全局租约准入限制同时一个生成，过期运行标记 unknown，旧租约／取消在途任务不提前释放容量。预留提交不明时不调用模型；完成提交不明时只查询原编号，不重新调用。模型失败、超时、结果未知保留保守费用预留。取消无法撤销已经发送的供应商请求及费用。

调用前重新检查来源、取消状态、当前 Profile、连接启停／修订及 24 小时内能力证明；调用后再次核对配置和来源状态，变更时不交付可用候选。配置检查和外网请求不构成跨供应商原子事务，已发送的请求不能因随后撤销自动退款。

调用复用现有 HTTPS 域名白名单、DNS 公网检查、固定地址和证书验证，禁止重定向；SDK 不重试、不调用工具，保持 1 MiB 响应上限。业务生成使用服务端固定的 **45 秒总截止**（含 DNS、HTTPS、完整响应及结果解析），不再复用连接能力测试的 3–20 秒设置；连接及 Profile 修订、输出 token 上限、预算规则均不变。该截止低于接口 `maxDuration=60` 秒，预留 15 秒空间用于其余工作，但不能保证数据库拥塞时一定完成记账；平台中断仍依赖既有租约和原编号恢复，禁止自动重试。该代码修复须合并部署后才生效，9 月 18 日首次生产验收使用的仍是旧 10 秒截止。

生成用途的完整请求固定上限为 256 KiB，覆盖 48000 字节来源、最长提示词、结构化 Schema 与 JSON 转义；连接测试用途仍保持原有 32 KiB 上限，浏览器不能调整这些限额。45 秒内未完成仍保留 `unknown` 和费用预留；增加等待时间不代表生成已验收通过或供应商未计费。

### 脱敏故障诊断

- 保留任务状态与费用语义，在既有 `error_code` 中记录固定分类：`generation_timeout`、`generation_provider_rejected`、`generation_network_error`、`generation_dns_failed`、`generation_invalid_response`、`generation_invalid_output` 等；调用后的资料／配置复核失败记录 `generation_postflight_failed`。无新增数据库列或权限。
- 后台任务卡片显示对应中文说明。旧任务的 `generation_unknown` 不会被事后改成推测原因；先对账原任务，不自动新建 UUID 或重放。
- 服务端结构化日志事件 `signal_generation` 只含 `run_id`、`phase`、`outcome`、白名单 `code`、该阶段 `elapsed_ms`、`timeout_ms`。阶段区分 provider、preflight、postflight、completion；completion 无法确认时使用 `completion_unconfirmed`，不能把模型调用完成当成数据库提交完成。
- 不记录原文、提示词、候选正文、密钥、连接串、端点、供应商原始响应／错误／堆栈。日志写入失败不会改变预算、任务提交或重试行为。日志耗时不是新增的任务持久化字段。

**生成预算是独立新增的 AI 预览准入预算，不是既有解析预算，也不是供应商账单硬上限。** 部署前必须单独确认合并计算的总预算；不能把原来批准的解析 10／50 美元重复授权给 AI。新预算无默认值，代码上限仍为单批 10 美元、UTC 日 50 美元；快照与当前限额取更严格值。估算使用所选连接配置单价、保守 UTF-8 输入边界和输出上限；观测用量高于预留时取更大值，推理／缓存／其它附加计费仍须供应商侧限额。该账本与连接能力测试账本分开，不声称合并计费上限。

## 生产启用前的独立审批

2026-09-18 预算与模型续接：独立生成每批 5 美元／UTC 日 10 美元（`5000000`／`10000000` microUSD）已获批并随临时启用部署生效，仅限合成资料、私有候选、验收后关闭。`deepseek/deepseek-v4.1-flash` 基础连接与结构化输出测试通过，“DeepSeek 私有候选验收 2026-09-18”r1 已保存（三阶段默认提示词、输出上限 2048、随机性 0.7、不要求工具能力）。随后一次合成输入业务生成返回 `unknown / generation_unknown`、无候选，保留估算 0.203730 美元；未重试，验收未通过。开关已恢复为 0，关闭配置部署 Ready，线上选择和创建控件全部禁用，运行时关闭已核验。费用须对账，错误码不能单独证明超时根因。详见[本次记录](production-evidence/2026-09-18-generation-connection.md#一次合成输入生成验收2026-09-18)。

截至 2026-09-18，`0015` 生产迁移、独立 Schema 核验、生成角色最小列授权及 owner 目录验收均已完成；专用 Production Secret 保存及重新部署后，真实生成凭据／客户端 TLS／身份／最小权限只读预检六项全部通过，见[连接验收记录](production-evidence/2026-09-18-generation-connection.md)。独立预算已获批，但真实业务生成尚未验收通过。PR #100 已交付生成代码；数据库分阶段结果见[准备记录](production-evidence/2026-09-17-generation-preparation.md)和[独立维护门禁](ONLINE_MAINTENANCE.md#ai-私有候选生成批次0015)。旧的 `accept-unverified-import-tasks` 仅覆盖截至 `0014` 的固定清单，不能用旧风险审批重放 `0015`；代码交付、数据库授权和新增 AI 费用授权彼此独立。

| 配置                                     | 含义                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `HZENSE_SIGNAL_GENERATION_ENABLED`       | 默认关闭；完成独立授权与验收后显式设为 `1`                                                |
| `HZENSE_GENERATION_DATABASE_URL`         | 新 `hzense_generation_admin`，只访问生成任务表；沿用已核准 Neon pooled／TLS／目标绑定规则 |
| `HZENSE_GENERATION_BATCH_LIMIT_MICROUSD` | 单批 AI 生成估算上限，必填，无默认                                                        |
| `HZENSE_GENERATION_DAILY_LIMIT_MICROUSD` | UTC 日全局 AI 生成估算上限，必填，无默认                                                  |

不扩大 `hzense_import_admin`、`hzense_ai_admin`、Runtime 或 Publisher 权限。导入正文和 AI 凭据分别经现有服务端受限连接读取；生成角色不能读取这些表。新角色须独立评审最小列授权，严禁复用 migrator／owner 连接。不得为本功能下载生产密钥到本地。

角色配置候选为 `db/roles/create_generation_admin.sql`（Neon 管理身份创建全新空角色）和 `db/roles/configure_generation_admin.sql`（目标库 owner 审核并授予固定列权限）。先迁移并独立核验，再按各脚本规定的数据库和身份执行；不要合并为一段在错误数据库中运行。脚本不轮换已有密码，不清洗 PUBLIC ACL，发现已有越权即拒绝。`assertGenerationRoleProvisioned` 供受控线上 owner 只读复核目录权限，`assertGenerationRole` 以专用角色自身核对；目录检查不能替代真实 Production 凭据、TLS 和目标连接验收。

这些目录检查只验证目标库权限及其他数据库的数据库级 ACL；允许精确 Neon 保留库形态，但不连接 `postgres`／`template1` 深检内部对象。应用库中扩展所属函数沿现有策略豁免，不能据此声称所有扩展函数都已安全审计。SQL 本身也无法辨认 Neon 分支，操作者仍须核对 `main` 与目标连接；新增未知扩展或保留库变化须另行检查。

## 生成关闭时的线上只读连接预检

在 `/admin/signal-generation` 点击“运行只读连接预检”，显式同源 `POST /api/admin/signal-generation/preflight`，请求正文仅允许 `{}`。入口要求管理员会话、固定 Host／Origin、无查询参数；响应仅有六项布尔检查和固定错误码，使用私有禁止缓存策略。页面加载、链接预取和刷新不会自动执行预检。

预检只依赖 Production 专用连接与现有目标绑定，不要求开启生成、不要求配置 AI 预算。它建立短生命周期连接，验证实际客户端 TLS 证书、真实 `session_user=current_user`、目标数据库以及共享最小权限合约；事务显式只读，最后回滚并关闭连接，不读取候选正文，不调用任务列表的过期恢复，不访问 AI。相同服务实例内的并发预检共用一个在途检查，不产生多个同时打开的预检连接。

六项均通过仅证明本次生产连接预检成功，不证明 Profile 就绪、AI 费用已授权、真实模型验收完成或公开发布就绪。后续仍需独立确认预算与输入外发范围；不为测试连接提前打开生成。

## 代码与验证入口

- `packages/ingestion/src/signal-generation-contract.mjs`：来源边界、严格候选 Schema 和引用验证。
- `packages/database/src/signal-generation-store.mjs`：幂等、事务租约、预算与私有结果。
- `packages/database/src/ai-config-store.mjs`：受信服务端执行资格与临时凭据解析。
- `apps/web/lib/signal-generation-provider.ts`：真实 AI SDK 结构化生成适配，测试注入合成 HTTPS 响应。
- `apps/web/lib/signal-generation-core.ts`、`lib/server/signal-generation.ts`：服务端读取、准入、调用与完成流程。
- `apps/web/components/admin-signal-generation.tsx`：两步执行、原编号恢复、私有候选展示。

新增数据库原生回归、契约单测、真实 SDK／合成 transport 测试、HTTP 鉴权测试及合成浏览器回归；具体执行结果以本轮进展记录为准。这些不是 Google／Neon／供应商生产端到端验收。

2026-09-17 本地验证：全仓默认 2684 项测试通过；另行开启的完整原生 PostgreSQL 迁移回归 583 项通过（含 SCRAM 密码认证）；构建后认证／HTTP 21 项通过；候选生成真实组件浏览器测试 12 项通过。构建、类型、lint、工作流校验通过。默认跳过项不计为通过，供应商请求均为合成 transport，没有实际模型费用。任务固定链接为 `/admin/signal-generation/[id]`，查询会将本人的过期运行任务恢复为未知结果，不释放原有费用预留，也不重新生成。

## 后续与局限

下一步是独立公开证据读取、事实与人物身份核验、跨文档稳定事件去重、正式 Source／Person／Signal 组装，再接合格发布。当前同一输入的幂等不能替代跨文档事件去重；资料切片／长文、未知费用对账、自动来源、持续 Worker 和全文 OCR 均未由本增量交付。
