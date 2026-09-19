# HZense 开发进度看板

**最后更新：** 2026-09-19
**当前阶段：** 旧网站 MVP 已交付；生产数据库 `0015` 迁移及独立 Schema 核验已成功（16 迁移／48 表）。管理员登录、AI 配置、信号只读工作台及常用格式私有导入已上线；导入与原件清理均已开启。当前开发第三阶段的 AI 私有候选生成，正式信号事实核验、发布与新版公开网站切换仍未完成。
**仓库：** [hzense/tech-intelligence-hub](https://github.com/hzense/tech-intelligence-hub)

> 本看板区分“工程基础”“网站 MVP”“MVP 生产就绪度”和“完整科技情报平台”。百分比是人工估算，不以文档数量或提交数量代替产品进展；MVP 已完成不代表完整产品已完成。

## 当前优先级：Signal-first v2 重构

**候选篇幅与输出额度调整（2026-09-19，代码待提交／部署）：** 按用户要求将新生成候选摘要从 800 收紧至 500 个 Unicode 码点；标题 50、单次最多 5 条不变。Schema、系统提示与服务端校验共用限制，新增 500／501 边界及 8192 token 请求参数回归。新建 Profile 的提取阶段默认输出 8192，核验／分析仍默认 2048，历史修订不覆盖。生产配置已通过后台另存 r4，并刷新核对提取 8192、其余两阶段 2048；模型、提示词、连接 r5 和预算均未更改，没有调用 AI 或重试失败任务。摘要 500 的硬校验需本批代码部署后生效，生产 r4 保存成功不代表新篇幅规则已上线；285 秒模型截止仍不变，也不保证 8192 tokens 能在该时限内输出完毕。

**历史候选可读性修复（2026-09-19，本地完成，待提交／部署）：** 验收结束关闭生成后，发现历史列表与详情也被同一开关拦截；此前固定结果读取是在切回关闭版本完成前，不能证明关闭后可读。现已将历史读取与生成门禁分离：只依赖专用数据库配置，保留管理员、owner、目标／TLS／角色校验，以只读事务查询，不外发正文、不更新状态或预算；新建／执行／取消仍受原开关控制。详情复用可读候选卡片，JSON 折叠展示。相关测试 52 项通过，Web 全套 457 项通过／8 项跳过，数据库存储单测 9 项通过，Web／数据库类型检查、Web Lint 和构建通过。未调用生产 AI、未变更开关或权限；真实 PostgreSQL 集成与关闭开关后的线上页面仍待 CI／部署核验。原验收证据和旧未知任务保留不变。

**真实非空候选验收通过（2026-09-19 本地时间／2026-09-18 23:08 UTC）：** 经独立授权，DeepSeek Profile r3（OpenRouter r5）仅对既有 NVIDIA Run:ai 公告调用一次。任务 `5f9c8bdb` 持久化为 `completed`，生成 1 条私有待审核候选；标题 23／50、摘要 346／800 个 Unicode 码点，日期为 2024-04-24，关联 Omri Geller／Run:ai，8 处引用逐字匹配解析原文，未混入旁栏新闻或把拟收购写成已完成。日志 provider 41,957ms、保存阶段 70ms、截止 285,000ms；用量输入 3.577K／输出 0.815K tokens，保守记账 0.244265 美元（非实际账单）。已恢复项目开关 `0` 并 Promote 相同代码的关闭部署，正式站禁用状态已确认。该单样本通过不等于长期稳定性、自动采集、独立事实核验或公开发布完成；旧未知任务未重试或改写。见[验收证据](production-evidence/2026-09-18-real-candidate-acceptance.md#五分钟版本单次验收2026-09-18-2308-utc)。

**生成等待延长（2026-09-19，已交付）：** [PR #113](https://github.com/hzense/tech-intelligence-hub/pull/113) 评审与 CI 通过后已合并为 `515c6b6`，本地 main 同步，合并后 CI `35403208198` 成功。生产版本采用 5 分钟接口时限、285 秒模型截止，预留 15 秒供校验和保存，原 7 分钟租约不变；页面及真实调用日志确认新时限生效。本次调用少于旧 45 秒上限，不能据此断言旧失败只需延时即可消除。预算仍为每批 5／UTC 日 10 美元，验收结束生成关闭。

- 本地验证：生成逻辑 20 项及浏览器组件回归 16 项全部通过；覆盖 284,999ms 返回成功、285,000ms 中止、租约／接口时限关系和历史任务提示。类型检查、修改文件 ESLint 及差异空白检查通过；均为模拟供应商，无生产模型费用。

**OpenRouter r5 单次复验（2026-09-19 本地时间／2026-09-18 22:21 UTC）：** 经用户授权，复用当前连接 r5 的有效能力证明，既有 DeepSeek 验收 Profile 保存为 r2，三阶段绑定 r5，模型和提示词等不变。对同一 NVIDIA 公告仅执行一次新任务 `b2febede`，固定记录为 `unknown / generation_timeout / result=null`；日志确认 provider 在 45,002ms 达到 45,000ms 截止时间，保守记账 0.244265 美元（非实际账单，token 未知）。无非空候选可供质量验收，不重试、不发布。已将 Ready 的关闭部署 `6hDJXs2Aq` Promote 回正式域名，重新打开工作台确认生成禁用；预算仍为每批 5／UTC 日 10 美元。下一步先对账原请求并补齐安全超时／输出诊断，不凭能力测试通过宣称业务生成成功。详见[复验记录](production-evidence/2026-09-18-real-candidate-acceptance.md#openrouter-r5-单次复验2026-09-18-2221-utc)。以下记录保留为历史状态。

**真实资料验收续接（2026-09-18 21:58 UTC）：** 第 1 项生产部署验收已通过：PR #112 的重部署 Ready，线上资料检查入口可用、生成库只读预检六项通过。第 2 项仅对获批 NVIDIA Run:ai 公告执行一次 DeepSeek 调用，输入 8,877 字节；请求 `a78d4109` 持久化为 `failed / generation_sdk_error`、结果为空，provider 耗时 18.003 秒，估算记账 0.244265 美元（非实际账单）。未重试或发布，非空候选质量验收未通过。关闭开关 `0` 已保存；新关闭部署 `6hDJXs2Aq` 因另一构建排队，已先将相同代码、开关关闭的已验证 `FNDkb9N2L` 恢复到 hzense.com，API 域名与工作台禁用状态确认运行时关闭。新关闭部署仍待完成，不等同于当前网站未部署。下一步先补齐安全异常子分类和输出完成原因诊断，不重复模型调用。详见[验收结果](production-evidence/2026-09-18-real-candidate-acceptance.md#单次真实资料验收结果2026-09-18-2155-utc)。下方早前部署等待等段落保留为历史记录。

**Production 重部署续接（2026-09-18 21:22 UTC）：** PR #112 原部署后续已 Ready 并绑定 hzense.com，资料检查入口可见。应用户要求，以相同 `de8e7d5` 发起一次无原构建缓存的 Production 重部署 `FNDkb9N2L`，当前仍为 INITIALIZING；Vercel 官方同期报告部署触发错误增多，尚不能宣称此次重部署完成。当前线上首页 HTTP 200、生成数据库只读预检六项全部通过，AI 生成仍关闭、无模型调用。两条 Turborepo 环境变量 warning 尚未修复。见[续接证据](production-evidence/2026-09-18-real-candidate-acceptance.md#重新部署与只读核验2026-09-18-2122-utc)。

**PR #112 交付与真实候选验收准备（2026-09-18）：** 生成资料检查和 50／800／5 候选限制已评审合并为 `de8e7d5`，本地 main 同步，main CI `35390971897` 成功。20:48 UTC 核对时，对应 Production 部署仍为 INITIALIZING，创建超过 20 分钟且页面构建日志仍为 Loading，尚未确认上线。已核对 DeepSeek Profile 证明有效、生成预算每批 5／UTC 日 10 美元；用户已确认仅使用 NVIDIA 官方 Run:ai 公告进行一次私有候选验收，临时开启、无重试、结束恢复关闭。当前暂停于生产部署门禁，未调用真实模型、未启用生成或发布，未取消或重复部署。见[本轮记录](production-evidence/2026-09-18-real-candidate-acceptance.md)。以下本地开发记录保留为交付前历史。

**候选长度收紧（2026-09-18，本地开发）：** 标题最多 50 字、摘要最多 800 字、单次最多 5 条候选。按 Unicode 码点计数，模型提示、结构化输出 Schema 和服务端校验共用限制；超限拒绝，不截断或改写历史数据。未调用生产模型，尚未提交或部署。

**AI 生成工作台续接（2026-09-18，本地开发）：** 在既有 3a 私有候选生成基础上增加“检查生成资料”，展示片段数、实际来源 JSON 字节数、解析版本与前 3 个片段定位，超限或检查失败明确阻止页面新建任务，切换资料清除旧检查。共用生成来源校验，不返回正文、不调用模型、不预留预算；创建／执行仍重新校验。未修改生产开关、预算、数据库权限或公开发布流程；长文切片及非空真实候选质量验收仍待后续。本批尚未提交或部署。

**导入任务分组（2026-09-18，本地开发）：** 默认仅展示当前任务，已完成、已取消批次移至“历史记录”；失败、部分完成和结果未知继续展示。数据库在分页前筛选，切换视图重置分页，保留解析结果与审计信息，不删除数据、不变更权限或原件清理策略。Web 默认测试 449 通过／8 跳过，另行开启导入浏览器回归通过，Web 类型与 lint 通过；新增数据库集成用例待可用隔离 PostgreSQL 或 CI 执行（本机临时安装缺少初始化文件）。本次尚未提交或部署。

**原件下载表示校验（2026-09-18）：** 诊断版 PR #109 已合并、生产部署并通过 main CI；确认故障触发点为 `blob_etag_mismatch`。正在验证原件 GET 显式请求 `Accept-Encoding: identity` 的定向修复，仍严格校验 ETag、路径、字节数和固定回执。449 项 Web 默认测试通过、8 跳过；修复生产有效性尚待现有失败批次验证，未触发解析或 AI。

**手动导入冲突诊断（2026-09-18）：** PR #108 已合并并部署，main CI 成功；随后用户报告两项文件原件确认返回 `document_conflict`，仍停留等待原件。正在补齐固定原因码与脱敏日志，并阻止确认冲突后盲目重传；不放宽完整性校验、不启动解析／AI。Web 默认测试 446 通过、8 跳过，类型与 lint 通过；生产根因仍待诊断版部署后确认，见[诊断记录](production-evidence/2026-09-18-import-conflict.md)。

**导入布局与原件不归档（2026-09-18，本地开发）：** 导入页调整为折叠配置诊断、文件／链接双栏、独立任务列表及解析结果侧栏；删除未接通的发布意图，提供独立 AI 生成导航。经操作者确认，原件仅处理期间临时存放，成功／失败／取消后主动条件删除，保留解析结果与审计；清理失败明确告警，未处理或异常遗留原件改为 24 小时读取截止＋小时任务兜底。原件失败需重新导入，不启用自动发布、不修改生产数据库权限。本批尚未提交、部署或执行生产原件删除。

本批本地验证：Web 默认测试 442 项通过、8 项环境保护测试跳过；另行开启导入／后台按钮浏览器测试 2 项通过，覆盖桌面与手机、私有结果转义、Escape 关闭与焦点恢复；构建、类型检查、lint、格式和工作流校验通过。Blob 删除使用替身与已有 SDK 条件删除契约验证，不等于生产删除验收。

**3a 修复交付与合成复验（2026-09-18）：** PR #104 已合并为 `89b7ad9`，PR／main CI 和 Production 部署通过。用户批准临时开启后，仅对新的虚构合成资料执行一次 DeepSeek 生成，任务 `e7527b3a-fa51-4b9e-ba2a-27c612c9e3df` 为 `completed`、错误码为空；provider 阶段 17.717 秒（超过旧 10 秒限制），提交阶段 69ms，固定链接可读取已保存结果。输入／输出 1588／176 token，保守估算记账 0.205185 美元，不是实际账单。模型明确识别虚构内容并返回零候选，真实调用、结构校验、预算记账、持久化和展示链路通过；非空候选及人物／引用／日期质量、独立核验和公开发布仍未验收。旧 unknown 任务未重跑或改写。生成开关已恢复为 0，关闭配置部署 Ready，线上控件禁用已核对；每批 5 美元／UTC 日 10 美元预算不变。详见[复验记录](production-evidence/2026-09-18-generation-connection.md#pr-104-交付后的单次合成复验2026-09-18)。

**3a 生成截止与诊断修复（2026-09-18，本地）：** 首次生成请求的生产日志显示执行 10.56 秒／平台上限 60 秒，与 OpenRouter r2 的 10000ms 截止吻合，高置信度指向应用超时，但旧记录未保留具体异常。已将业务生成独立为固定 45 秒总截止；能力测试仍保持原连接 3–20 秒，输出和预算上限不变。新增持久化的脱敏错误分类、后台中文说明及按阶段耗时日志；未知结果保留费用，不自动重试。代码尚未提交、合并或部署，生产开关仍关闭；原未知任务未改写，真实模型复验待后续受控执行。

**3a 合成生成验收（2026-09-18）：** 独立生成每批 5 美元／UTC 日 10 美元预算已随临时启用部署生效。合成 Markdown 上传和解析成功；使用“DeepSeek 私有候选验收 2026-09-18”r1 执行一次任务，结果为 `unknown / generation_unknown`、`result=null`，保留估算 0.203730 美元，未重试或公开发布。端到端候选生成验收未通过，下一步先对账原任务和补齐脱敏失败诊断。生成开关已恢复为 0，关闭配置部署 Ready，线上工作台选择与创建控件全部禁用，已确认运行时关闭。既有解析预算及保留策略不变。详见[本次记录](production-evidence/2026-09-18-generation-connection.md#一次合成输入生成验收2026-09-18)。

**3a 模型前置测试（2026-09-18）：** `deepseek/deepseek-v4.1-flash` 基础连接与结构化输出两项测试通过，Profile r1 保存并刷新核验，三阶段绑定 OpenRouter r2。两次测试保守估算合计 0.094720 美元，不是供应商账单；未测试工具调用。能力测试通过不代表上述业务生成成功。

**3a 线上连接预检（2026-09-18）：** [PR #103](https://github.com/hzense/tech-intelligence-hub/pull/103) 已合并为 `24449e1`，PR／main CI 和 Production 部署均成功，本地已同步。操作者保存专用 Production Secret 并重新部署后，真实管理员在线手动预检六项全部通过：Production 配置、专用凭据连接、客户端 TLS、真实身份与目标库、只读事务、最小权限合约。预检不读取候选正文、不处理过期任务、不调用 AI；当时生成尚未启用。相关 35 项单元／合成浏览器测试、构建后鉴权／HTTP 23 项（另 1 项可选浏览器测试跳过）、全仓无缓存默认测试和构建／类型／lint 已通过。此处仅记录连接验收，后续预算授权与一次生成结果见上，不能记为生成已可用。详见[连接验收记录](production-evidence/2026-09-18-generation-connection.md)。

**阶段记录（2026-09-17）：** [AI 信号候选生成 3a](AI_SIGNAL_GENERATION.md) 代码已合并部署：已解析资料选择、明确外发同意、当前 Profile 提取模型、持久化任务／预算／幂等、严格原文引用与人物／日期缺口、私有候选页面。生产 `0015` 迁移与独立 Schema 核验成功；操作者已创建 `hzense_generation_admin` 并保存密码，经执行时确认已完成最小列授权和独立 owner 目录验收。当时真实凭据／TLS／Production 连接、AI 费用与真实模型验收尚未完成；后续真实连接通过结果以上方 9 月 18 日记录为准。见[生产数据库准备记录](production-evidence/2026-09-17-generation-preparation.md)。不计第三阶段整体完成，不开启自动发布。

**3a 本地验证：** 全仓默认测试 2684 项通过；另行启用的真实 PostgreSQL 18／pgvector 原生迁移回归 583 项通过（含 SCRAM 密码认证），目标为 16 迁移／48 表；真实 Next.js 构建后的认证／HTTP 测试 21 项通过（1 项可选浏览器测试未启用），候选页面合成浏览器测试 12 项通过。类型、lint、构建与工作流校验通过。独立审查发现的预算收紧、来源错误提示、请求恢复、完整请求大小上限、过期任务查询恢复和配置修订冲突恢复问题已修复；首轮 CI 的测试角色密码缺失也已在隔离 SCRAM 环境复现并修正。默认测试中按环境跳过的数据库／浏览器／解析场景不计入通过数；这些结果没有调用真实供应商或修改生产库。以上为合并前的本地验证记录；PR、CI、合并与部署结果以对应交付记录为准，生产生成仍待独立授权与验收。

**3a 交付跟踪：** [PR #100](https://github.com/hzense/tech-intelligence-hub/pull/100) 已合并为 `fd528ea`，合并后 [main CI 35226592286](https://github.com/hzense/tech-intelligence-hub/actions/runs/35226592286) 成功；对应 Production 部署 READY 并绑定 hzense.com。匿名访问后台重定向登录，API 拒绝匿名。代码交付不执行生产 `0015` 迁移、不扩大角色权限、不授权新增模型费用，也不启用生成或公开发布。此处部署结果已在本批交付时核验，后续数据库准备不重新发起部署。

**3a 数据库准备核对：** 准备工件已通过 [PR #101](https://github.com/hzense/tech-intelligence-hub/pull/101) 合并为 `07684bb`，main CI 与对应 Production 部署成功。操作者已确认本批维护冻结和未演练恢复的风险；新生产备份已创建，保留至 2026-09-24 14:27:30 UTC，备份引用已绑定受保护环境。同 SHA 的只读 [preflight 35233782900](https://github.com/hzense/tech-intelligence-hub/actions/runs/35233782900) 经人工审批于 14:31 UTC 成功，当时仅待迁移 `0015`，四项绑定摘要齐全且新备份摘要一致。截至该预检当时，新角色授权或真实模型调用均未执行；后续 ACL 采集、迁移及角色授权结果见下，生成仍未启用。详见[续接记录](production-evidence/2026-09-17-generation-preparation.md#生产准备续接2026-09-17)。

**3a 准备工件验证：** 独立 `0015` 风险审批范围、生成角色创建／最小列授权、owner／runtime 权限审计和生产步骤已补齐；代码审查发现的 PUBLIC 重叠列泄露与额外 ACL 类别遗漏已修复。全仓默认 2810 项、完整原生 PostgreSQL 626 项通过，构建、lint、类型、格式和工作流检查通过；生成角色／创建身份的 SCRAM 认证及模拟 Neon 管理边另行验证。本批通过 `chore/generation-production-preparation` 分支交付，PR／CI／合并状态以对应记录为准，不是生产迁移或授权完成。

**3a ACL 采集结果：** [ACL 双采集 35234258207](https://github.com/hzense/tech-intelligence-hub/actions/runs/35234258207) 经人工批准于 14:49 UTC 成功，附件已上传并只读复核；两份 11 类／1,194 条目录记录一致，独立重算指纹与运行日志一致。该采集完成于迁移之前，尚未永久归档到代码仓，不代表恢复能力已验证；其指纹已绑定后续独立迁移审批。

**3a 迁移与独立核验：** [唯一 0015 迁移 35236708426](https://github.com/hzense/tech-intelligence-hub/actions/runs/35236708426) 经人工批准，于 14:58:44 UTC 成功；迁移内置核验返回 16 迁移／48 表，四项计划摘要与独立审批摘要全部匹配，`recoveryVerified: false`。独立只读 [verify 35237242986](https://github.com/hzense/tech-intelligence-hub/actions/runs/35237242986) 亦经批准，于 15:06:46 UTC 成功，16 迁移／48 表，本批 Schema 升级闭环完成。这两个操作本身不创建生成角色、授予生成访问权限、配置 AI 预算或开启真实模型调用；后续角色授权单独记录如下。

**3a 角色授权完成：** 操作者手动创建生成角色并保存密码后，授权前只读检查通过；再经执行时明确确认，完整授权事务在生产 `main/hzense` 成功 COMMIT。独立共享权限合约返回唯一 `safe=true`，owner 身份核验通过；15:34:42 UTC 的目录摘要确认 22 SELECT／12 INSERT／9 UPDATE 列 ACL、0 表级授权、1 数据库及 1 schema 授权，连接上限仍为 2。未读取密码、修改其他角色或开启生成。后续先补齐生成关闭时可用的线上只读凭据预检，再独立配置 Production Secret 并验收真实身份／TLS；AI 预算、启用及模型调用仍待批准。

**生产核对（2026-09-17，3a 提交前）：** PR #99 已合并为 `9845b5b`，main [CI 35121669913](https://github.com/hzense/tech-intelligence-hub/actions/runs/35121669913) 成功；Vercel `dpl_Hx4s9uint1yTR7AufqLCWeGDLEvY` READY 并绑定 hzense.com，版本一致。原件清理开关为 `1`，最新 [定时运行 35218090158](https://github.com/hzense/tech-intelligence-hub/actions/runs/35218090158) 成功，扫描 6、到期 0、删除 0；尚不能视为真实到期删除验收。以下 9 月 15 日条目保留为阶段历史，以本段及生产证据的后续结果为准。

**当前执行批次（2026-09-15）：** 已按操作者要求启动[后台信号工作台六阶段交付](SIGNAL_WORKBENCH.md)。顺序为只读工作台 → 批量导入 → AI 生成与独立核验 → 合格发布／读切换 → 新版公开页面 → 专题洞察。第一阶段由 PR #88 合并，PR／main CI 成功；整仓默认 2545 项、完整原生 PostgreSQL 521 项、构建后认证／HTTP 21 项、实际组件浏览器 7 项通过。经授权完成生产 Schema 只读核验、专用 reader 最小授权、Production-only Secret 和配置后部署，真实管理员页面及同源 API 已成功读取空列表，匿名拒绝及私有缓存边界通过。生产暂无 Signal 版本，真实非空详情／历史关联仍待后续数据接入验收，不能算六阶段全部完成。见[生产记录](production-evidence/2026-09-15-signal-workbench.md)。自动提交／评审／合并已获授权；下一阶段批量导入按设计推进，新增基础设施、真实模型费用和发布／数据源开关仍需明确授权。

操作者提出：不再新增日报／周报，以有关键人物关联的 Signal 为唯一信息源；合并专题与洞察；雷达成为首页并展示热点 TOP 10；资源由信号驱动、按组织近期活跃度排序并展示关键人物。补充要求：后台支持手动批量上传文档／超链接，触发 AI 信号生成及发布，纳入正式交付范围。

**第二阶段续接（2026-09-15）：** 已开始[批量导入中心 2a 接收前契约](../insights/2026-09-15-batch-import/README.md)，建立供应商独立的文件／链接声明校验和逐项错误契约；这不是已上线的上传／解析入口。后续依次完成私有持久化、原件接收／受控抓取、全格式解析／OCR 与可续跑 Worker、管理页面及端到端验收。现有来源整行参与公开资格 seal，采集运行状态将独立存储，不修改 seal 或公开数据源。新增生产资源、OCR 费用／隐私和最小权限仍分开确认。

**第二阶段 2b–2e 续接（2026-09-15，本地实现）：** 已加入[私有导入任务与上传处理](IMPORT_TASKS.md)：`0014` 七张私表、幂等批次、原件固定、租约／fencing、取消／重试、预算记账与专用角色 ACL 拒绝检查；`/admin/imports`、受保护 API、私有 Blob 直传确认、DNS 固定链接抓取、隔离解析器和单项 Worker 已实现。七类合成文件实际解析、角色隔离、接口与 Worker、桌面／移动组件测试通过。新 Schema 在隔离 PostgreSQL 为 15 迁移／47 表，不是生产结果。外部 OCR 按当前方案关闭；新云资源、生产迁移／授权、预算数值、调度配置、真实 Blob／Sandbox 端到端与保留／对账仍待独立审批或开发，不计整个阶段 2 完成，也未接通 AI 生成／发布。

**第二阶段生产交付（更新至 2026-09-17）：** `0014` 已提交，后续校验名单修复并独立 `verify` 成功；专用导入角色、最小权限、DSN、私有 Blob 与隔离解析镜像已配置。TXT 及 PDF／DOCX／Markdown／HTTPS 混合批次生产验收通过，导入和小时原件清理均开启；预演与正式清理成功但尚无真实到期删除。预算维持获批解析单批 10 美元／UTC 日 50 美元，原件保留 7 天。CSV／XLSX、复杂文档、并发／取消／重试、长期监控与持续处理调度仍待补充验收，OCR 关闭，不能标全格式第二阶段完成。见[生产记录](production-evidence/2026-09-15-import-production.md)。

详细页面与迁移契约见 [v2 重构设计](SIGNAL_FIRST_REDESIGN.md)，三类入口与 AI 运行技术契约见 [专项设计](AUTONOMOUS_SIGNAL_PIPELINE.md)，主产品入口见 [DESIGN.md](DESIGN.md)。以下是本次新范围，不继承旧 MVP 完成百分比。

- [x] V2-0 设计稿：四个页面、导航、后台流程、人物证据、评分、数据权威、历史迁移与验收已记录，并与初版专项契约 `b5a0045` 整合。
- [x] V2-0 Signal 策略统一：自动来源、文档和链接入口默认 `auto_publish`；可选预览／人工审核不改变默认，不在本次启用生产开关。
- [ ] V2-0 专题洞察默认发表策略确认；未明确配置前只生成预览。首次生产任务与发布开关另行配置验收。
- [ ] V2-1 数据关系：版本化 Signal、多来源证据、人物／组织任职、发表事务与历史导入。
  - [x] V2-1a 首批仓库实现：冻结 `3.0.0` Signal 快照契约，追加 `0004` 的 8 张私有表、类型化人物／组织与同版本证据外键；Drizzle、精确 verifier 和历史导入纯函数预演同步实现。见[实施契约](SIGNAL_V3_FOUNDATION.md)。[PR #68](https://github.com/hzense/tech-intelligence-hub/pull/68) 已合并为 `22e137a`，PR 与 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34726612068) 均通过；未执行生产迁移，不计为整个 V2-1 完成。
  - [ ] V2-1b 任职关系及证据、稳定事件键、不可变保护、受限角色与发表／撤回事务、Outbox。
    - [x] 首批任职与证据：复用 `relations` 的身份／方向／日期，追加 `0005` 两张私有表、类型化复合外键、保守按日区间判断与证据状态预检；见[实施契约](PERSON_ORGANIZATION_AFFILIATIONS.md)。[PR #69](https://github.com/hzense/tech-intelligence-hub/pull/69) 已合并为 `dd4d58f`，PR 与 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34727621783) 均通过，本地 main 已同步；未执行生产迁移，不代表 V2-1b 全部完成或资源页面已上线。
    - [x] 稳定事件身份：追加 `0006` 私有事件键登记、同版本证据锚点、严格目录校验与批量登记预演；见[实施契约](SIGNAL_EVENT_IDENTITY.md)。同键不同 Signal、同 Signal 换键或更改登记依据均阻断，不按先到先得覆盖；不确定身份与旧键提示暂缓。[PR #70](https://github.com/hzense/tech-intelligence-hub/pull/70) 已合并为 `d598eee`，对应 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34755795599) 全部通过，包含 56 项原生 PostgreSQL 集成；本地 main 已同步，未执行生产迁移。
    - [x] 历史版本封存与受限写入身份本地开发：追加 `0007`，版本和四类边只允许在创建事务内组装；提交后不能追加／改写历史，原文仅当前核验状态可变。新增 `hzense_signal_writer` 列级 INSERT 契约，不得自行审核或公开。完整 Schema、Runtime 和 Topic 预检精确检查函数／触发器，不放开未知对象。详见[实施与验证记录](SIGNAL_VERSION_IMMUTABILITY.md)。整仓 1145 项测试通过，构建／格式／lint／typecheck／内容／Seed／工作流校验通过；隔离 PGlite 验证通过。新增 75 项原生集成已接入 CI，本机总计 131 项因无专用连接跳过，仍待 PR CI；本批通过 PR 交付，评审／CI／合并结果另行确认，未执行生产迁移或生产角色配置。
    - [x] 封存交付后续核验：上述批次已通过 [PR #71](https://github.com/hzense/tech-intelligence-hub/pull/71) 合并为 `67ce485`，修复一处原生测试断言访问方式；PR CI 与 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34758602893) 全部通过，131 项原生 PostgreSQL 集成通过。本地 main 已同步；上条本地跳过记录保留为当时结果，不代表当前 CI 仍待运行。
    - [x] 当前增量本地开发：`0008` 私有发表状态／永久 Outbox 回执、独立发布修订号、原子配对和幂等转换、纯投影规划，见[实施契约](SIGNAL_PUBLICATION_OUTBOX.md)。整仓 1259 项单元测试通过，9 迁移／26 表隔离 SQL 验证零差异；新增 53 项原生集成已接入 CI，本机总计 184 项因无专用连接跳过，仍待 PR CI。本批通过独立 PR 交付，CI／评审／合并结果另行确认；不增加生产入口或角色授权，不代表资格化 Publisher 或搜索自动消费已经完成。
    - [x] Outbox 交付后续核验：[PR #72](https://github.com/hzense/tech-intelligence-hub/pull/72) 已合并为 `6db71c6`；修复新增外键改变 TRUNCATE 拒绝路径的测试，未放宽封存保护。PR 与 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34760910939) 均通过，184 项原生 PostgreSQL 集成通过；本地 main 已同步，未执行生产迁移。上条保留提交前本地证据，不代表当前仍待 PR CI。
    - [x] 当前增量本地开发：私有任务与发布控制，追加 `0009` 的持久化开关／策略／授权／运行，冻结原始任务意图，校验取消、数据库租约与 fencing；详见[实施与验证记录](SIGNAL_PUBLICATION_CONTROLS.md)。整仓 1432 项单元测试及构建／类型／lint／格式／内容／Seed／工作流校验通过；临时 PostgreSQL 18.4 / pgvector 0.8.6 的完整 260 项原生集成通过，包括新增控制套件 34 项、其中 13 项真实并发竞争。修复旧 writer 测试日期对默认时区的依赖，未放宽约束。本批通过独立 PR 交付，PR CI／评审／合并结果另行确认；未执行生产迁移，不接入完整 Publisher、AI 后台或生产入口。
    - [x] 控制交付后续核验：[PR #73](https://github.com/hzense/tech-intelligence-hub/pull/73) 已合并为 `f0fc283`；PR 与 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34763140875) 均通过，完整 260 项原生 PostgreSQL 集成通过；本地 main 已同步。上条保留提交前证据，未执行生产迁移。
    - [x] 当前增量本地开发：`0010` [已记录资格检查与原子发表](SIGNAL_QUALIFIED_PUBLICATION.md)克隆已封存且记录合格的候选，将当前依赖检查、完整新版本／四类边、head、Outbox 及运行绑定回执放进同一事务；失效与竞争回滚，永久幂等重试不恢复撤回内容。整仓 1624 项单元测试与构建／类型／lint／格式／内容／Seed／工作流校验通过；临时 PostgreSQL 18.4 / pgvector 0.8.6 的完整 318 项原生集成通过，其中新事务套件 46 项含 12 项真实锁等待场景。旧控制 TRUNCATE 测试显式补齐新外键依赖，未放宽断言／保护；测试实例已停止。本批通过独立 PR 交付，PR CI／评审／合并另行确认，不计为生产交付。
    - [x] 私有资格核心交付：[PR #74](https://github.com/hzense/tech-intelligence-hub/pull/74) 的 CI 通过，已合并为 `618c178` 并同步本地；随后 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34765438872) 数据库首组 157 项断言全部通过，但测试清理触发未捕获 `57P01`，整个任务失败，后续角色组未运行。已定位为 Pool 关闭与强制终止连接的竞争并本地修复：3 个套件等待真实零连接后清理，新增 10 项单元与 3 项原生回归；整仓 1634 项单元通过，完整 321 项原生回归连续三轮通过。不改业务 SQL／权限；修复通过独立 PR 交付，CI／评审／合并另行确认，不视为远端 main CI 已恢复。详见[失败与修复记录](SIGNAL_QUALIFIED_PUBLICATION.md#pr-74-合并后-ci-清理竞态2026-09-13)。
    - [x] CI 清理修复交付：[PR #75](https://github.com/hzense/tech-intelligence-hub/pull/75) 已合并为 `3eef3f9`，对应 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34768195574) 成功。上条保留故障现场，不表示当前 main 仍失败。
    - [x] 当前增量本地开发：`0011` [受控核验记录与候选组装](SIGNAL_CANDIDATE_VERIFICATION.md)。已核验原文和已封存候选的完整材料绑定可信记录，只在新版本确认人物／组织边，不更新共享 Evidence、不改历史、不写公开 head 或搜索。整仓 1807 项单元测试与构建／类型／lint 通过；独立 PostgreSQL 18.4 / pgvector 0.8.6 上完整 374 项原生集成通过，含本批 31 项候选链路原生回归和 Runtime／writer 各 11 项权限拒绝。12 迁移／33 表精确目录检查通过；材料指纹补齐姓名别名、来源性质和精确 JSONB 数值绑定。待独立 PR 交付，不计为生产迁移或 AI 核验执行器上线。
    - [x] 候选核验交付后续核验：[PR #77](https://github.com/hzense/tech-intelligence-hub/pull/77) 已合并为 `33163b0`，对应 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34775752832) 成功。上条保留提交前本地证据，不代表仍待 PR 交付；认证上线未执行本批生产迁移或 Signal 写入角色配置。
    - [x] 当前增量本地开发（2026-09-13）：`0012` [受限公开发布与安全撤回](SIGNAL_PUBLIC_PUBLICATION.md)。新增核验依赖 seal、原子公开许可及 `current_public_signals` 安全视图；受限 Publisher 严格核对核验／组装链、当前材料、任务／租约和版本修订，独立撤回不依赖总开关或原租约。后台新增独立鉴权的发布／撤回表单与 API；新版网站和信号搜索直接读取同一当前资格视图，不需手动同步第二份正文，失效不可由恢复旧值或重放历史回执复活。默认仍为旧模式，未执行生产迁移、角色授权、密钥配置或读切换；PR／CI／评审／合并另行确认。
    - [x] 本批隔离验收：整仓 2007 项单元、完整 391 项原生 PostgreSQL 集成、17 项构建后认证／接口 HTTP 场景、默认模式 28 项桌面／移动端浏览器回归全部通过；旧／新模式构建和类型／lint／格式／工作流／内容／Seed 检查通过。精确目录为 13 迁移／35 表／1 视图／16 函数／41 触发器。完整回归补齐旧 Topic／Runtime 对新视图的精确结构识别，未放宽其旧 ACL；详细范围及生产待验项见[本地验收](SIGNAL_PUBLIC_PUBLICATION.md#本地隔离验收2026-09-13)。
    - [x] 受限公开发布交付：[PR #78](https://github.com/hzense/tech-intelligence-hub/pull/78) 已合并为 `8f892de`，本地 main 已同步，对应 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34780736808) 成功；上条本地验收不是生产迁移或数据源切换证明。
    - [ ] 后续交付：Publisher／Reader 最小权限兼容审计 → 内容就绪后切换并做真实发布／搜索／撤回验收；再完成历史导入和数据权威迁移。2026-09-14 已在 AI 配置批次完成截至 `0013` 的生产结构迁移，但未配置发布角色或切换读取。认证剩余验收见 V2-2；原文核验执行器、AI 任务和完整业务后台仍待接入，记录的 verified、私有 published 或历史回执均不是可公开许可。
  - [ ] V2-1c 历史导入事务、冲突／幂等核验、统一读取及权威切换。预演保留旧状态与引用，不自动补造人物、生成原文证据或提升为新版 published。
- [ ] V2-2 AI 后台：管理员认证、模型列表／手填与分阶段 Profile、独立能力测试／兼容故障切换、密钥保护、来源增量及机器临时准入、预算、手动／定时任务与审计。
  - [x] 分阶段配置体验本地开发（2026-09-14）：三个阶段复用连接页可搜索的模型下拉框，选择连接后加载该修订目录，同页共享成功列表；切换／修订变更清空对应旧模型。按 Signal-first 设计预填提取、独立核验、专题分析三份可编辑中文提示词，保留历史自定义内容；取消温度输入，新保存修订固定 `0.7`，不迁移历史。补齐原编号恢复及迟到响应不能清除其他请求的保护，不自动重试未知结果、运行能力测试或启动业务任务。Web 默认测试 336 项通过、4 项 opt-in 跳过；显式启用连接／Profile 组件浏览器 34/34、隔离 PostgreSQL 配置主流程 7/7 通过，构建／类型／lint／格式／工作流校验通过。临时数据库与角色已清理，一次性集群已停止；未连接生产或真实供应商。以上是提交前本地验收，未提交 PR 或部署，不计为整个 V2-2 完成。见 [默认提示词与交互边界](AI_CONNECTIONS.md#分阶段模型与默认提示词)。
    - 桌面 1280px／移动端 390px 实际浏览器补查：真实组件和 CSS 的合成 HTTP 夹具显示三份默认提示词、三个独立模型选择控件且无温度输入，选择连接仅触发一次 `models` 请求，展开及选择未追加 API 请求；无页面／控制台错误或横向溢出。此次夹具不连接真实供应商、生产数据库或 Google 登录，浏览器与临时服务检查后关闭。
  - [x] 模型选择交互合并本地开发（2026-09-14）：将独立下拉框与手填框合成一个可编辑组合框，支持大小写不敏感搜索、展开全部候选、鼠标／键盘选择和无列表时手填；选择不自动请求，完整保留 `~` 别名。补齐光标编辑／IME、连接修订刷新与移除清空旧值，保留未知结果与禁用门禁。Web 默认测试 326 项通过、3 项 opt-in 跳过；单独启用的组件浏览器 18/18 通过，构建／类型／lint／格式通过；桌面和 390px 移动视口无页面错误或横向溢出，合成环境搜索／选择未发 API 请求。以上为提交前本地验收；PR／CI／合并／部署状态另行核验，不以本地检查代替线上交付。见 [AI 配置使用路径](AI_CONNECTIONS.md#管理员使用路径)。
    - 本批隔离链路补测：真实组件 → HTTP → PostgreSQL 18.4／pgvector 0.8.6 的配置主流程 7/7 通过，保留别名、权限、原编号重试、未知结果、CAS 与 Profile 修订断言；测试库／角色清理完成，一次性实例已停止，未连接生产或调用真实供应商。
  - [ ] OpenRouter 模型列表兼容与显式选择（2026-09-14）：本地代码已统一模型 ID 校验，支持一个前导 `~` 并全链保留原值；新增当前连接／修订的模型下拉选择，不自动调用。补充目录、调用、测试恢复、Profile 与浏览器回归；待提交、CI、部署及生产模型列表复验，不能把合成或隔离测试视为线上完成。见 [AI 配置使用路径](AI_CONNECTIONS.md#管理员使用路径)。
  - [x] OpenRouter 精确域名授权（2026-09-14）：按操作者明确授权，Production 白名单追加 `openrouter.ai` 并保留 Gateway；`main@30c5820` 重新部署 READY，新管理员页面已确认两个允许域名。供应商预设与明确错误提示由同批代码交付，PR／新 UI 部署另行验收；没有替操作者保存 API key 或调用模型，真实连接与 Profile 验收仍待完成。见[授权记录](production-evidence/2026-09-14-ai-configuration.md#openrouter-域名授权与表单改进)。
  - [x] AI 配置生产结构迁移（2026-09-14）：PR #80 已合并为 `5a03b1e`，[main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34793904068) 成功且同 SHA Production READY；新预检确认 10 项精确 pending，独立 ACL 双采集成功。首次 ACL 请求因漏填备份存在性声明在连接数据库前被门禁拒绝，新 run 审批后成功，不复用失败审批。[迁移](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794365453)及[独立 Schema 核验](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794509473)成功，均为 14 个迁移／40 张表；[Runtime 自身预检](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794586203)及公开数据库健康检查通过。本批保留恢复能力未验证。见[生产记录](production-evidence/2026-09-14-ai-configuration.md)与[ACL 审核](production-evidence/acl/34794203356-1/review.md)。
  - [x] AI 配置基础设施启用与空状态验收（2026-09-14）：操作者确认现有角色密码已保存并明确授权后，五表最小列权限提交及独立只读复核通过，数据库 URL 与根密钥环已保存为本项目 Production-only Secret，原白名单保留。PR #82 的 `main@15ffd409` 首次配置后部署因 TLS 参数不符而页面关闭；仅修正同一 Secret 参数，第二次部署 READY 并绑定正式域名。真实 Google 管理员登录后，连接与 Profile 页面可编辑，正常页面刷新两个列表 GET 均为 200；匿名双 401、公开数据库健康 200，短窗口浏览器及错误日志无匹配，不外推长期无错。授权后连接／Profile／测试记录均为 0，随后未保存配置或调用真实 AI；供应商保存／加解密、模型及 Profile 端到端资格仍待验收，不计为整个 V2-2 完成。未改密码、再次迁移或启用 Signal 发布、新读取及采集任务。见[部署与最小验收](production-evidence/2026-09-14-ai-configuration.md#配置后部署与最小验收)。
    - Neon 凭据创建重试历史：用户反馈 Run 失败后，当时只读确认连接身份正确且 AI 角色仍不存在。隔离 PG18 复现了创建者系统管理边不能自行 REVOKE，原零成员关系守卫不兼容；已修正为仅接受精确云管理员入向边，禁止 AI 角色继承其他角色。104 项原生测试及独立安全复核通过，修正脚本当时已重新准备到 Neon 页面，后续由 PR #82 交付。上述授权阶段开始时角色已存在且操作者确认密码已保存，没有新建角色、重置密码或再次执行生产迁移，见[重试检查](production-evidence/2026-09-14-ai-configuration.md#新角色创建重试检查)。
  - [x] PR #79 评审修复本地验证（2026-09-14）：修复 Profile 新建／更新契约及连接／Profile 安全重放；五表改显式列级 SELECT 并增加提交前 ACL 复核；补齐表单 POST、连接修订刷新、域名显式授权、错误分类、类型声明和预算说明。新增真实组件→HTTP→受限 PostgreSQL 配置主流程并接入 CI，供应商仍为模拟调用。整仓 2245 项单元、451 项原生 PostgreSQL、配置主流程 7 项（含父测试）、构建后认证 19 项和全站浏览器冒烟 28 项通过，其余构建／静态／内容门禁通过。初次 2219／440 验收没有覆盖配置页面保存主流程，下条保留当时证据，不再作为该路径通过的依据。修复由 [PR #79](https://github.com/hzense/tech-intelligence-hub/pull/79) 承载，远端 CI、合并和生产配置另行确认。见[修复与补测边界](AI_CONNECTIONS.md#pr-79-评审修复与补测2026-09-14)。
  - [x] 当前增量本地开发（2026-09-13）：[AI 连接与分阶段模型配置](AI_CONNECTIONS.md)。新增 `0013` 五张私表、专用 `hzense_ai_admin` 最小角色、信封加密、端点白名单与固定 DNS 连接、模型发现／手填、三类独立能力测试和提取／核验／分析 Profile。测试先登记预算并持久化再调用，幂等／并发／超时及版本失效保护已实现；整仓 2219 项单元、完整 440 项原生 PostgreSQL、19 项构建后认证／HTTP／浏览器回归和全站 28 项桌面／移动冒烟通过，构建、lint、类型、格式、依赖审计及内容／Seed／工作流校验通过。通过独立 PR 交付，评审／远端 CI／合并另行确认，不计为整个 V2-2 完成。未配置生产密钥、执行生产迁移或真实模型调用，不含自动采集、批量导入、执行器或任务调度。
  - [x] 管理员认证本地实现（2026-09-13）：按操作者选择接入 Google 单账号登录；服务端单 Gmail 白名单、已验证邮箱和 Google `sub` 绑定、PKCE／state／nonce、逐页面／API 独立鉴权、1 小时绝对会话时效及同源／CSRF 防护。`/admin/login`、`/admin` 和只读会话 API 已实现；缺配置和 Preview 均关闭认证。102 项新增单元回归、14 个构建后 HTTP 场景及全站 28 项桌面／移动端浏览器回归通过；HTTP 隔离回归接入 CI。见[认证与上线配置](ADMIN_AUTH.md)。与候选核验增量通过同一 PR 的独立提交交付，远端 CI／评审／合并另行确认；尚未部署，不含真实 Google 登录验收、生产 OAuth 配置、数据库写入授权或 AI／导入功能；真实账号只应放在服务端配置，不进仓库。
  - [x] 认证交付与上线后续核验（2026-09-13）：上述本地实现已随 PR #77 合并，main CI 成功。专用 Google Web OAuth 客户端及五项 Production-only Secret 已配置；`33163b0` 的认证配置后部署 `dpl_7WkBFjeDqQDBDeCybkaFfVsjyM3A` 已 READY 并绑定 `hzense.com`，构建耗时 1 分 5 秒。指定管理员真实 Google 登录／后台访问／退出、匿名页面和会话 API 拒绝访问均已核验。详见[脱敏上线记录](production-evidence/2026-09-13-admin-auth.md)。上条“尚未部署”保留为当时结果；不代表 Signal 生产迁移、业务发布授权或 AI／导入功能已交付。
  - [ ] 认证扩展验收：非白名单真实账号、线上 Preview 禁用、已登录会话 API 的独立 HTTP `200` 验收和长期错误监控仍未完成；短窗口无错误与客户端阻断均不能替代验收。后续业务操作仍须独立鉴权，不用登录结果替代 Publisher 的资格和任务授权。
  - [x] 批量导入设计：正式定义文档／链接／混合批次、AI 生成并发布、逐项结果、重试与隐私边界，见设计第 7.4 节；仅为设计完成。
  - [x] `/admin/imports`、批次详情、私有上传／链接接收、安全解析、定位和结果查看已实现；常用格式已完成生产验收，详情见第二阶段生产记录。
  - [ ] 全格式生产验收、OCR、跨文档事件去重及发布同步；已解析不等于已生成或已发布。
  - [ ] AI 信号生成 3a：本地接通私有候选生成、任务持久化、原文引用和人物／日期建议；新迁移／角色、实际模型费用、PR 与生产验收单独推进。独立事实核验、正式实体绑定和稳定事件去重仍待接通，见 [AI_SIGNAL_GENERATION.md](AI_SIGNAL_GENERATION.md)。
  - [ ] 验证全部文件类型、批量部分成功、一文多信号、多文同事件、失败重试、预算限制、取消竞争和私有材料防泄漏。
  - [ ] 实现原文更新／撤稿／反证的有界自动扫描与再核验；验证链接失效不误撤回、依赖洞察和公开投影收到更正。
- [ ] V2-3 信号与资源：多维筛选／聚合、人物组织详情、活跃度排序、搜索自动同步。
  - [x] 当前增量本地开发：新读模式下列表／详情／关联信号和信号搜索采用同一当前资格视图，并展示公开人物、组织、研判和来源字段；旧索引 Signal 命中全部排除，数据库故障不回退 Seed。新版趋势尚未实现，旧 Radar 快照因无版本绑定暂停展示。此项不代表整页重设计、多维聚合或生产切换完成。
- [ ] V2-4 雷达首页：可解释 TOP 10、领域趋势、低样本／覆盖不足状态。
- [ ] V2-5 专题洞察：固定专题、每周及手动深入分析、冻结证据、正文版本与更正。
- [ ] V2-6 迁移上线：人物补证和内容就绪核对、旧路由归档、停用 Daily 新生产、生产验收。

整合基线为 `main@9477ec9`；该基线 Seed 有 82 条 accepted Signal、19 个 Entity、0 个 Person。人物补证是实际开发与迁移工作，不是已完成。设计沿革以初版专项契约 `b5a0045`（原 PR #64 初版）为输入，保留自动发布、完整导入、来源／模型／任务机制，移除未来 Daily／Weekly 新增生产路线，并以人物补证／legacy 档案替代旧状态直接映射公开。整合范围为七份设计文档；设计交付与工程实施、数据迁移及生产切换分别记录和验收，不能将文档完成计作应用、数据库、工作流或生产配置已变更。

### 既有网站指标一致性修复（2026-09-13）

本地已完成专题／雷达四项指标单一来源修复：专题列表与详情的 `assessment` 和首页／雷达统一取
`data/seed/radar.yaml` 的最新 Topic 快照，移除五篇 Topic Markdown 的重复评分并由 Schema 拒绝重新引入。
无快照显示 `—`／“待评估”，零分保留；已补最新日期选择、列表／详情／雷达读取一致性、归档、缓存不变性
和 Radar 输入触发构建缓存失效的回归。Web 48 项、内容包 377 项测试通过，网站构建通过。
这不是重新评分、数据库迁移或 v2 上线；本批通过独立 PR 交付，远端 CI／评审／合并另行确认，
尚未部署，也未进行浏览器页面验收。

**交付后续核验：** 上述提交前状态已由 [PR #76](https://github.com/hzense/tech-intelligence-hub/pull/76) 交付，合并提交 `9b022ee`；[main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34769039522) 全部通过，含 26 项生产浏览器冒烟测试。本地 main 已同步；该提交的 Vercel Production 部署 `dpl_EAGqjVpdWsMJWnSLfzG4dzjDxntP` 已 READY 并绑定 `hzense.com`。生产浏览器确认专题列表、AI 安全详情、雷达均为 `55／上升／涌现期／中`。这是指标读取一致性修复，不代表重新评分或 v2 上线。

## 原 MVP 总览（历史口径）

下表和旧阶段记录保留既有成果与当时估算，不代表 2026-09-12 新版完成度，也不构成本轮生产状态复核。

| 进度轴           | 当前进度 | 状态          | 判断                                                                                 |
| ---------------- | -------: | ------------- | ------------------------------------------------------------------------------------ |
| 开发基础建设     |     100% | ✅ 完成       | 架构、Monorepo、数据模型、冻结依赖安装和内容交叉引用校验均已通过 CI                  |
| 网站 MVP         |     100% | ✅ 验收完成   | Home、Daily、Weekly、Insights、Topics、Signals、Resources 与基础搜索均由验证内容驱动 |
| 生产就绪度       |      98% | 🟡 运维收尾中 | 线上路径及有界告警已验收；Runtime ACL 恢复证据、provider 指标和旧 Alpha 仍未关闭     |
| 完整科技情报平台 |  55%–65% | 🟡 扩展阶段   | 按整体开发量和复杂度粗估，剩余约 35%–45%；详见下方剩余工作清单                       |

### 整体估算口径（2026-09-06）

完整平台范围包括网站展示、持续内容运营、数据库与混合搜索、时间线、知识图谱、自动采集处理和带引用的智能问答。按这些能力的开发量与复杂度，当前粗估已完成 **55%–65%**，剩余 **35%–45%**。该区间不是按任务数量计算的精确统计，也不是工期或上线日期承诺；拆分和验收后应重新估算。

网站页面、工程基础和既定 MVP 已完成，剩余工作主要集中在持续获取信息、组织知识和生成可靠回答。上表 **98% 仅沿用此前 MVP 生产运维口径**，不表示完整平台只剩 2%，也不代表 FTS-1 已完成生产切换。

## 原平台工作记录与延续事项

以下保留此前阶段的证据和待办来源。与 v2 冲突的产品路线以顶部新清单为准；未被取代的安全、部署与工程约束继续有效。本轮不重新安排已取消的恢复演练。

### 1. FTS-1 数据库搜索生产上线

**2026-09-11 最新状态：已上线。** `main@f72ccb9` 的正式部署
`dpl_DV9WMCgbHpd3ScNCwAMXzd2hAFGo` 已 READY，`hzense.com` 使用
`HZENSE_SEARCH_MODE=database`。迁移 `0003`、38 条回填、零变更复核、
十二列最小授权、连续两次 Runtime 预检、21/21 shadow 比对与正式搜索/六类过滤均通过；
[云端健康验收](https://github.com/hzense/tech-intelligence-hub/actions/runs/34540048804) 成功。
详见[生产切换记录](./production-evidence/acl/34535908960-1/cutover.md)。
本轮没有执行恢复演练；恢复能力与历史 ACL 缺口仍未验证，应用回滚路径仅复核、未实切演练。
本次提交包含新证据；待 PR 审核合并后才计为 main 归档。

**2026-09-10 历史决策：** PR #55 已合并为 `22a4201`，对应 main CI 成功。
操作者明确取消本轮恢复验证/隔离演练，并同意开发
[显式风险接受审批路径](./ONLINE_MAINTENANCE.md#fts-1-显式接受恢复未验证风险)。
[PR #56](https://github.com/hzense/tech-intelligence-hub/pull/56) 已合并为 `9220df0`，
[main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34497860991) 成功；
经人工审批的 [production preflight](https://github.com/hzense/tech-intelligence-hub/actions/runs/34498279486)
成功，仍有 1 个 pending migration。随后发现只读 `acl-capture` 尚未支持该路径，
本次补齐其独立风险审批与明确标记“恢复未验证”的证据输出，待 PR 评审/合并后线上执行。
备份存在性与目标/期限、当前完整 ACL 基线、main CI、人工审批和回填指纹仍保留。
现场只读状态摘要不替代独立双采集，详见[9 月 10 日检查点](./production-evidence/2026-09-10-fts1-preflight.md)。
恢复能力与历史 ACL 缺口保持“未验证”，
不再作为本轮新增演练待办，也不标记为已验证。下列带日期记录保留历史事实；
本轮后续顺序为 ACL 采集入口修复评审合并 → 复核最新 main/CI、备份与冻结窗口 →
受保护独立 ACL 双采集及归档审核 → 迁移/回填 →
单独审核 Runtime 最小授权 → shadow → 搜索切换验收；不重跑全量 ACL normalization。

- [x] PR #45 已于 2026-09-06 squash 合并为 `main@a5a4bca`；统一三种模式输入校验、页面错误提示和数据库搜索健康探测均已交付，PR 与合并后 main CI 通过。
- [x] 2026-09-06 已开始生产准备：新建七天分支备份，生产与备份只读计数一致；正式站当前部署与健康基线通过。详见[上线准备记录](./production-evidence/2026-09-06-fts1-preparation.md)。这不代表恢复演练通过；现阶段等待受保护维护连接和 ACL 恢复门禁闭环。
- [x] 2026-09-07 操作者批准 GitHub Actions + Neon + Vercel 全线上维护方案，保留共享实现/CI 测试；本地临时密码入口、专用测试、说明和配置文件已移除。专用 `production-maintenance` 环境已创建并回读确认：仅 main branch、人工审批、禁止管理员绕过，八项非密码参数已配置。
- [x] 受保护维护入口已通过 [PR #47](https://github.com/hzense/tech-intelligence-hub/pull/47) 合并为 `main@88b7570`，合并后 [CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34121384366) 通过；不代表生产任务已执行。
- [x] PR #47 第一条非阻塞 review 建议已通过 [PR #48](https://github.com/hzense/tech-intelligence-hub/pull/48) 合并为 `main@333245f`，合并后 [CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34141929106) 成功：执行入口再次校验 main/最新 CI/审批有效期并阻断 API 异常。只读 preflight 已实跑成功，写操作未执行；检查与执行仍非原子操作，第二条依赖供应链隔离建议保留为后续工作。
- [x] 2026-09-08 两个连接 Secret 名称已确认存在；只读 [preflight #34212653428](https://github.com/hzense/tech-intelligence-hub/actions/runs/34212653428) 经操作者审批后成功，Migrator 直连与预检合约通过，待迁移数为 1；Runtime 凭据尚未实跑验证。
- [x] 2026-09-08 操作者知情批准在当前公开仓库保存完整 ACL 与无凭据恢复材料，不创建私有仓库；范围见[归档约定](./production-evidence/acl/README.md)。密码、连接串、Token、原始备份 ID 与业务数据仍不得公开。
- [x] `acl-capture` 线上双采集及公开附件入口已通过 [PR #49](https://github.com/hzense/tech-intelligence-hub/pull/49) 合并为 `main@8ed8e87`，合并后 CI 成功；尚未实跑，实际证据永久入库、恢复 SQL 审核与隔离演练仍待完成。
- [ ] 2026-09-08 [搜索上线验收检查点](./production-evidence/2026-09-08-fts1-release-checkpoint.md)：DDL/发布冻结已确认；新增恢复基线和隔离副本，经明确授权执行副本 Reset from parent，恢复后计数与 Topic、迁移记录指纹与基线一致。完整 ACL 恢复审核/演练仍未完成，尚未发起采集或执行生产写入。
- [x] 不自动过期备份审批兼容修复已通过 PR #50 合并为 `main@b4619e6`，合并后 CI 成功；2026-09-09 已用于只读 `acl-capture` 审批，不放宽写操作恢复门禁。
- [x] 2026-09-09 [ACL 双采集](https://github.com/hzense/tech-intelligence-hub/actions/runs/34326646837) 经操作者审批后成功；两份基线独立重建校验通过，11 类目录与总指纹一致。详见[采集检查点](./production-evidence/2026-09-09-fts1-acl-capture.md)。
- [x] 真实 ACL 基线与审核记录已随 PR #51 永久入库；详见[恢复方案](./production-evidence/acl/34326646837-1/recovery-plan.md)。
- [x] 2026-09-09 开发受限 FTS 十二列 ACL 恢复候选、只读目录指纹与测试，并完成静态自审；不代表提交、CI 通过、独立审批或线上执行。
- [x] PR #53 修复提交 `bd8f8c3` 的 [CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34363934742) 全部通过，恢复 SQL PostgreSQL 集成测试 14 项通过；修复后本地数据库包 378 passed / 49 skipped（新增静态测试 7 项，集成测试 14 项本地跳过）。证据见[验证与评审更新](./production-evidence/acl/34326646837-1/recovery-sql-review.md#修复后验证与评审更新)，不代表后续提交或合并后的 CI 通过。
- [x] PR #53 已合并为 `main@23ed839`，同 SHA 的 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34368875223) 三项任务全部成功。恢复源的三项可信 Neon 身份参数已通过浏览器只读实测，Search 仍为 10 列、启用事件触发器为 0；详见[身份核验检查点](./production-evidence/acl/34326646837-1/neon-identity-checkpoint.md)。这不是 R1/R2 或恢复演练证据。
- [x] 2026-09-10 开发[隔离恢复线上只读验证入口](./RECOVERY_VERIFICATION.md)：R0–R3 双采集、run-bound 审批与目标摘要约束、独立 Runtime 恢复态权限检查；生产 FTS 预检不放宽。代码和本地测试完成不代表入口已合并、线上实跑或演练通过。
- 历史边界：R1/R2 适配、隔离恢复演练与历史 ACL 缺口没有获得恢复成功证据；操作者取消本轮恢复验证，未新建或延长演练分支。该风险不因搜索上线而消失，也不重新列为本轮演练待办。
- 历史检查：[2026-09-08 上线门禁复核](./production-evidence/2026-09-08-fts1-gates.md) 记录当时尚未迁移/回填/切换及当时的分支期限；它不是当前状态。最新备份存在性/期限与双采集记录以本轮 [review](./production-evidence/acl/34535908960-1/review.md) 为准，仍不证明可恢复性。
- [x] 通过受保护线上执行验证现有维护/Runtime 凭据，完成最新独立 ACL 双采集及 artifact 归档；未读取或轮换密码。写操作采用单独 run-bound 风险接受审批，见[线上手册](./ONLINE_MAINTENANCE.md)。
- 全量 destructive Runtime ACL normalization 的恢复门禁未解除；本轮只执行另行批准的十二列 GRANT。
- [x] 在生产应用并验证 `0003_search_documents_fts.sql`（2026-09-11，柏林时间）。
- [x] 完成 Search Document 受保护回填、指纹校验和无变更重跑：38 条，独立复核 0 增删改。
- [x] 更新 Runtime 搜索十二列最小读取权限，连续两次生产 preflight 成功；未运行全量 normalization。
- [x] 完成 21/21 shadow 对账并切换 database 模式；搜索、六类过滤、健康与早期错误日志验收通过。
- [ ] 审核合并本轮生产证据归档 PR；应用回滚已复核但未实切演练，恢复能力仍按操作者决定保持未验证。

完成标准：按 [FTS-1 上线顺序](./DEPLOYMENT.md#fts-1-数据库搜索上线顺序) 留存生产执行与验收证据；代码合并不计作生产上线。

### 2. 持续内容运营（旧路线由 v2 取代）

- [x] 已实现确定性 Daily 候选生成、dry-run 和人工发布门禁。
- [x] 2026-09-12 实现 `daily-v2` 选材修正：保留前一日采集窗口，并要求事件／公告发生于 cutoff 前 72 小时内；生成与发布校验共用限制，记录超期排除原因，历史补录仍保留在 Signals。本轮交付代码与文档，合并及在线执行新规则仍需后续完成。
  - 本地验证：84 项内容测试、类型检查、lint 及内容交叉引用校验通过；以 2026-09-12 为日报日期，从 82 条 Signals 中选出 5 条近期候选，因事件超期排除 66 条，其余按既有资格条件排除。临时目录生成与重复运行验证通过，未写入正式日报或触发发布。
- [x] 2026-09-11 经操作者批准开启组织及仓库 Actions PR 权限，并回读确认 `CONTINUOUS_DAILY_PUBLISH_ENABLED=true`；默认 Token 只读权限与分支保护不变。
- 已取代：将自动 Daily Draft PR 实跑作为下一阶段产品目标；新版切换后停止 Daily 新生产，旧结果按历史记录保留。
- [x] 2026-09-11 完成[首批 5 条近期真实 Signals 录入](./content-intake/2026-09-11-signals.md)，附一手链接、日期依据和评分理由；操作者在会话中明确“全都接受”，5 条均已改为 `accepted`，本轮提交评审，尚未合并或用于生产 Daily。
- 历史验收归档：[PR #61 的 Signals 页面抽样与搜索索引同步](./production-evidence/2026-09-12-signals-search-sync.md)。绑定历史提交 `3ada816`，新增 67 条搜索投影，最终复核 112 条 unchanged；不代表当前生产计数或业务 `signals` 表入库。归档时仅回读 GitHub 证据，未重跑生产维护，恢复能力仍未验证。
- 已取消新增：日报／周报持续发布产品；已有内容与 URL 转为历史档案，不标为删除或已迁移。
- 已转入 V2-2／V2-5：自动 Signal 生产、专题洞察的周度更新和内容质量验收。

新版完成标准：真实信号有可核查的人物和来源，按配置形成公开版本，并同步搜索／首页／资源；专题按规则产生可追溯的深入洞察。

### 3. 自动采集与处理

- [ ] 分批接入 RSS、arXiv、GitHub、博客、公司来源与 Newsletter。
- [ ] 实现去重、分类、实体提取和候选排序，保留原始来源与采集时间。
- [ ] 建立候选、补证／暂缓及按配置选择的发布流程，验证采集失败重试及重复运行不会重复入库；人工审核不再作为所有任务固定必经步骤。

本段并入顶部 V2-1／V2-2／V2-3，细化采用专项设计 A–E 的阶段映射，不另建平行待办。三入口默认自动发表与首版表格／OCR 是整合后固定范围。

完成标准：来源 → 候选 → 证据与人物核验 → 按所选策略发布全流程可追溯；自动发表不能绕过质量与权限规则。

### 4. 知识呈现

- [ ] 实现实体时间线与基于 Signal 的事件时间线。
- [ ] 基于已有实体关系模型与数据，补齐关系图谱可视化和实体、信号、内容之间的导航。

完成标准：用户能从时间线或图谱追溯到具体事件、内容与证据来源；已有关系模型不等于图谱产品已交付。

### 5. 智能检索与问答

- [ ] 实现内容分块、Embedding 生成、pgvector 写入与内容更新后的重建机制。
- [ ] 实现关键词与向量混合检索，并用评测集验证召回与排序效果。
- [ ] 实现 Ask HZense / RAG 与可核查的来源引用。
- [ ] 建立回答质量、引用准确性、证据不足处理、延迟与成本评估。

完成标准：回答由可追溯证据支撑，检索与问答质量达到事先约定的验收标准；安装 pgvector 不代表语义检索或 RAG 已完成。

### 6. 运维收尾

- [ ] 补齐备份恢复验证与 Runtime ACL 恢复证据，记录恢复流程及演练结果。
- [ ] 建立 Neon provider 侧连接、PgBouncer 池容量及数据库阈值监控。
- [ ] 经授权收紧旧 Hosted Alpha 的访问并验证正式站不受影响。
- [ ] 跟踪已明确延期的凭据轮换事项，保留现有操作者决定与风险记录。

完成标准：恢复能力有证据、容量异常可告警、旧站访问边界明确；具体约束见“当前风险与阻塞”。

### 建议执行顺序

当前以顶部 **V2-0 → V2-6** 为新开发顺序：先建立信号／人物／证据和后台采集，再交付信号资源、雷达首页与专题洞察。混合搜索／RAG 和完整关系图谱不抢占本轮核心链路。恢复未验证风险保持记录，不重启操作者已取消的演练。

进度证据：[PR #45](https://github.com/hzense/tech-intelligence-hub/pull/45)、[合并后 main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34057251891)。2026-09-06 的只读检查中，正式站首页、`/search?q=OpenAI` 与 `/api/health/database` 均返回 HTTP 200，健康正文为 `{"status":"ok"}`；该观察不证明 FTS-1 生产迁移或 database 模式已启用。

## 阶段看板

| 阶段                      | 状态      | 完成度 | 完成定义                                                                             |
| ------------------------- | --------- | -----: | ------------------------------------------------------------------------------------ |
| 0. 品牌与产品基线         | ✅ 完成   |   100% | HZense 品牌、产品定位、模块、官方域名和 MVP 范围确定                                 |
| 1. 技术与信息架构         | ✅ 完成   |   100% | 技术栈、Source of Truth、信息模型、taxonomy 和 ADR 确定                              |
| 2. Development Foundation | ✅ 完成   |   100% | Monorepo、Schema、Migration、Validation、Seed、锁文件与冻结安装均已验证              |
| 3. Web Application Shell  | ✅ 完成   |   100% | Next.js、Tailwind、App Router、主题、全局布局和导航可运行                            |
| 4. MVP 内容与功能         | ✅ 完成   |   100% | Home、Daily、Weekly、Insights、Topics、Signals、Resources、基础搜索和独立 Radar 可用 |
| 5. Production Release     | 🟡 进行中 |    98% | 域名、Schema、Topic 投影、Runtime 及有界告警已验收；证据、provider 指标与访问待收尾  |

## 已完成

- [x] HZense 产品设计与品牌基线
- [x] `hzense.com` 作为正式生产域名
- [x] Next.js / PostgreSQL / Drizzle / pgvector / Vercel 技术架构
- [x] Information Model v2.0.0、证据完整性契约与 taxonomy
- [x] PR #29 固化 Taxonomy → Seed → Content 的 Topic 权威链、引用约束与 CI 门禁
- [x] PR #30 将 `0002_topic_projection.sql`、完整 Taxonomy 投影同步器和最小权限同步角色配置脚本合并到 `main`，完成仓库与 CI 交付
- [x] 2026-08-31 在新可恢复分支备份保护下完成生产 `0002`、最小权限 `hzense_topic_sync`、62 条 Topic 投影、独立验证与 0 变更 no-op 重跑
- [x] pnpm workspace 与 Turborepo 工程边界
- [x] TypeScript、ESLint、Prettier、Vitest 和 Playwright 基础配置
- [x] PostgreSQL / Drizzle Schema、顺序 Migration、事务执行器与 pgvector CI 验证
- [x] 受限迁移角色、Migration checksum manifest、生产 direct/TLS 预检与只读完整 schema verifier
- [x] Markdown Front Matter Zod Schema 与基础单元测试
- [x] Topic、Entity、Relation、Source、Signal 种子数据
- [x] Daily、Weekly、Insight、Topic 样例内容
- [x] GitHub Actions CI 工作流定义
- [x] Foundation CI 完整通过（install、lint、typecheck、test、content validation、seed validation）
- [x] Next.js Web Shell、响应式首页、全局导航与亮色/暗色主题
- [x] HZense Daily 列表页和历史 seed 详情页
- [x] HZense Insights 列表页、动态详情页与首页入口
- [x] HZense Topics 列表页、动态详情页与关联情报入口
- [x] HZense Weekly 列表页、动态详情页与 Daily / Topic 证据链接
- [x] HZense Signals 列表页、动态详情页与类型化 Seed runtime
- [x] HZense Resources 列表页、动态详情页与双向实体关系
- [x] 已发布 Daily、Weekly、Insights、Topics、Signals、Resources 的基础关键词搜索
- [x] 独立 Radar 页面、类型化快照、可分享筛选、评分级 Signal 证据与原始来源链接
- [x] 经过 Schema 与交叉引用校验的 Markdown/MDX Web runtime
- [x] Continuous Daily 确定性候选生成、完整 dry-run、人工发布门禁与回滚手册
- [ ] Continuous Daily 自动 Draft PR（2026-09-04 保持默认 token `read` 的 repository enable 请求被组织策略以 HTTP 409 拒绝；`can_approve_pull_request_reviews=false`、发布变量缺失，未 dispatch/建分支/PR）
- [x] HZense 品牌 Logo、Open Graph 分享图和基础 metadata
- [x] [Hosted Alpha 历史检查点](https://hzense-technology-intelligence.zhenghu-tte.chatgpt.site)（2026-09-04 只读审计为 active v6 / public、匿名 HTTP 200）
- [ ] 经显式授权后将 Hosted Alpha 收紧为 owner-only，并验证匿名访问拒绝及正式站不受影响
- [x] [Vercel Production Deployment](https://tech-intelligence-hub-web.vercel.app/)
- [x] GitHub PR Preview 与 `main` Production 自动部署
- [x] [正式生产域名](https://hzense.com/)与 HTTPS
- [x] `www.hzense.com` → `hzense.com` 重定向
- [x] canonical、sitemap 与 robots 搜索引擎元数据
- [x] 404、运行时错误与全局错误界面
- [x] 桌面端与移动端 Playwright 生产冒烟测试
- [x] 基础安全响应头
- [x] Neon PostgreSQL 18.6 / pgvector 0.8.6 生产实例、受限迁移角色、迁移前快照与完整 Migration 验证
- [x] 架构决策记录（ADR）

## 当前里程碑：生产加固与上线后监控

### P0 — 先让基础可重复验证

- [x] 生成并提交 `pnpm-lock.yaml`
- [x] 使用 frozen lockfile 安装依赖
- [x] 确认 lint、typecheck、unit tests、content validation、seed validation 全部通过
- [x] 在 GitHub 上保留可核查的[最终 head CI 记录](https://github.com/hzense/tech-intelligence-hub/pull/7/checks)
- [x] 补充内容中的 Topic / Entity / Signal 交叉引用校验

### P0 — 建立第一个可见网站

- [x] 在 `apps/web` 初始化 Next.js App Router
- [x] 集成 Tailwind CSS 与 HZense 视觉基础
- [x] 实现全局布局、导航、页脚、亮色/暗色主题
- [x] 实现响应式首页
- [x] 实现 HZense Daily 列表页
- [x] 实现 HZense Daily 详情页
- [x] 通过 `@hzense/content` 加载并校验 Markdown 内容
- [x] 建立桌面端和移动端 Playwright 冒烟测试
- [x] 发布可访问的 [Hosted Alpha 检查点](https://hzense-technology-intelligence.zhenghu-tte.chatgpt.site)
- [x] 生成第一个 [Vercel Preview URL](https://tech-intelligence-hub-web-git-c-d83d2c-zhenghu25-6909s-projects.vercel.app)（启用 Vercel Authentication）

### P1 — 扩展 MVP

- [x] Insights
- [x] Topics
- [x] Weekly
- [x] Signals
- [x] Resources
- [x] 基础关键词搜索
- [x] 手工维护的 Radar（独立路由、类型化快照、评分说明与可追溯证据链）
- [x] sitemap、robots 和 canonical metadata

### P1 — 生产发布

- [x] 创建托管 PostgreSQL 18 / pgvector 0.8.6 实例
- [x] 执行并验证 2026-08-29 生产基线（2 个 Migration、13 张表、当时 0 个待执行 Migration）与 2026-08-31 `0002`（当前 3 个 Migration、0 pending）
- [x] 建立 [Vercel Production Deployment](https://tech-intelligence-hub-web.vercel.app/)
- [x] 绑定 [`hzense.com`](https://hzense.com/)
- [x] 配置 `www.hzense.com` → `hzense.com` 重定向
- [x] 验证 HTTPS 与 HTTP → HTTPS 跳转
- [x] 验证错误页与基本安全响应头
- [x] 验证生产安全日志并启用小时级基础健康监控；2026-09-04 受控手工 run 33854492063 再次通过有界合约，此前的 scheduled-record 间隙仅记作调度延迟观察而非故障
- [x] PR #40 于 2026-09-04 合并为 `main@0012871`；精确 commit 的 Production 部署与直接健康检查通过，受控 run 33855492933 按预期在真实探针成功后触发单例 Issue #43，恢复 run 33855536113 仅追加一条恢复评论并关闭同一 Issue

### P1 — Git / YAML → PostgreSQL Topic 投影

- [x] PR #29 确立 Taxonomy、Seed、Topic Content 和 PostgreSQL 派生投影的权威边界
- [x] PR #30 已将 `0002_topic_projection.sql` 与完整 Taxonomy 投影同步器合并到 `main` 并完成仓库与 CI 验证；该状态不代表任何生产数据库动作完成
- [x] 由操作者创建并验证新的可恢复分支备份，以受保护声明值应用并独立验证生产 `0002_topic_projection.sql`
- [x] 创建独立最小权限 `hzense_topic_sync`，以 owner 执行已评审 ACL 配置，并验证受保护的同步连接与 expected identity
- [x] 使用 reviewed source/plan fingerprint 完成持锁写前校验、事务 Apply、独立只读验证与 no-op 重跑；结果为 62 个 Topics、0 个未知行、fingerprint 匹配和 0 变更
- [x] 为 Runtime Reader 上线创建新的七天 provider 分支备份，盘点角色与数据库 ACL，设置 `hzense_runtime` 的 read-only session 默认值，并撤销未使用 `neondb` 的 ambient `PUBLIC` 访问
- [x] 将维护专用 `hzense_migrator` 的 connection limit 从 5 调整为 10，解除 Neon Tables 占满旧五连接上限导致的 `53300`；该决定不扩大 Web Runtime 权限，Runtime Web pool 上限仍为 1
- [x] PR #32–#35 合并独立 Runtime Reader、Server-only 数据库客户端、安全健康检查、有上限的只读业务查询及 Neon provider 合约
- [x] 以独立 catalog-only 查询确认目标 `hzense` Runtime ACL 当前已应用，并验证有效权限、直接授权来源与五列 allowlist
- [x] PR #36 合并小时级生产健康检查的 fail-closed 变量门禁，并固定允许的触发器与 cron
- [x] 在受保护流程中生成并保存独立 Runtime 凭据；候选 provider-object 合约连续两次通过目标库及精确允许的 Neon `postgres` / `template1` 完整生产 preflight
- [x] 仅向 Vercel Production 注入 pooled 连接与 expected identity，触发 Runtime-configured 重部署并独立验证健康检查、真实五列读取与安全日志
- [x] 记录 2026-09-04 操作者决定：知情接受既有 handling-exposure risk 并将 Production Runtime 轮换延期到本轮之外；本轮未读取或修改凭据/配置，轮换义务仍开放
- [x] PR #42 修复早期 CI 暴露的空 ACL 数组 SQLSTATE `22023`，完整 CI 通过并 squash 合并为 `main@0806e349`；精确 Production 部署和线上健康合约通过，且未执行生产 ACL 捕获或数据库 mutation
- [ ] 核验 mutation 前 provider backup/PITR；若无法找回，则正式接受历史缺口。PR #42 已交付 forward-only hashed backup reference / baseline fingerprint / session guard，但没有核验生产备份、采集生产 baseline 或重建历史 ACL，禁止据此再次 normalization
- [x] 建立应用层有界数据库健康告警：安全分类 `53300` / `57014` / 通用查询错误 / 五秒总耗时，记录脱敏池计数，并经单例 Issue 创建与恢复关闭演练验收
- [ ] 补充 Neon PgBouncer client-capacity 与独立 provider 侧连接、池和数据库阈值监控；PR #40 不声称覆盖该边界
- [x] PR #41 的 FTS-0 canonical projection、排序器抽取、稳定 fingerprint 与完全平局 total-order 已通过最终评审、完整 CI、合并及 Production 兼容性验收
- [x] FTS-1 仓库开发：独立 `0003`、Search Document 同步、加权 `tsvector`/GIN、精确 parity 查询、shadow 与 fail-closed database 模式已实现
- [x] FTS-1 生产切换：2026-09-11 已按风险接受路径完成 Migration、受保护回填、最小 Runtime ACL/双 preflight、shadow parity、cutover 与功能/健康验收；应用回滚仅复核未实切，恢复能力未验证，详见本页最新记录。

2026-08-31 的生产维护窗口已有现场证据：新分支备份确认可恢复，`0002` 已执行，3 个 Migration / 0 pending，`hzense_topic_sync` 与最小 ACL 已复核，dry run → Apply → 独立 verifier → no-op 全部完成，最终 62 个 Topics、0 个未知行且 reviewed fingerprint 匹配。随后完成了 Runtime Reader 的新七天回滚分支、角色/ACL 盘点、`hzense_runtime` read-only 默认值、`neondb` ambient ACL 隔离与 Migrator 连接容量治理；PR #32–#35 已把仓库实现与 Neon provider 合约合并到 `main`。2026-09-01 又以两组 catalog-only `SELECT` 独立确认目标 `hzense` ACL 的有效权限和直接授权来源，[脱敏结果](./production-evidence/2026-09-01-runtime-reader-acl.md)仅保留布尔值、计数与指纹。PR #36 于 2026-09-02 合并健康监控门禁，PR #38 于 2026-09-03 固定现场验收的 provider catalog 合约。同日，独立 Runtime 凭据与目标/保留库完整 preflight 通过；五个 server-only 值仅配置到 Vercel Production，Runtime-configured 部署、线上 health、真实五列读取、安全日志与小时级工作流首次手工运行均通过[功能/配置生产验收](./production-evidence/2026-09-03-runtime-reader-production-acceptance.md)。生产就绪度据此提高至 98%。2026-09-04，PR #40 的精确 Production 部署、健康合约、受控单例 incident 创建与恢复关闭均通过；PR #42 修复 `22023`、通过完整 CI、合并并完成部署兼容性验收，但没有执行生产 ACL 捕获、provider backup/PITR 核验或数据库 mutation。PR #41 随后完成 FTS-0 和生产兼容性验收。当时 FTS-1 尚未执行；2026-09-06，PR #45 已合并为 `main@a5a4bca` 并通过合并后 CI。生产最近已验收的基线仍是三 Migration、旧 Runtime ACL 与 in-process 查询，`0003`、回填、shadow 和 cutover 尚无完成记录。[脱敏运维检查点](./production-evidence/2026-09-04-operations-checkpoint.md)同时保留四项未闭环状态：操作者知情接受既有凭据处理暴露风险并将轮换延期到本轮之外，轮换义务仍开放；历史 ACL 恢复材料不足且 provider backup/PITR 未核验；Continuous Daily 被确认的组织策略阻断；Hosted Alpha 仍公开且 owner-only 尚待显式授权。

## MVP 验收状态

| MVP 验收项                                                     | 状态 | 当前证据 / 缺口                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home、Daily、Insights、Topics、Weekly、Signals、Resources 路由 | ✅   | PR #12–#14 已实现 Weekly、Signals、Resources 列表与详情路由，并通过 Vercel Preview 页面验收                                                                                                                                                    |
| 桌面端与移动端可用                                             | ✅   | PR #11 在 Desktop Chrome 与 Pixel 7 视口验证 Home、Daily、Insights、Topics、404、metadata 与安全响应头                                                                                                                                         |
| Markdown/MDX 通过验证层加载                                    | ✅   | [PR #6 head CI](https://github.com/hzense/tech-intelligence-hub/pull/6/checks)验证同一加载器用于 CI 校验与 Web 构建                                                                                                                            |
| Topic / Entity 引用无断链                                      | ✅   | Seed 与内容引用均由 CI 校验                                                                                                                                                                                                                    |
| 基础关键词搜索                                                 | ✅   | PR #16 接入六类公开内容、相关度排序、类型筛选及双视口验收                                                                                                                                                                                      |
| 手工 Radar                                                     | ✅   | PR #17 接入页面与可视化；[PR #19](https://github.com/hzense/tech-intelligence-hub/pull/19)增加评分说明、明确 Signal 引用与 HTTPS 原始来源                                                                                                      |
| 亮色与暗色主题                                                 | ✅   | Web Shell 已实现主题切换                                                                                                                                                                                                                       |
| CI 全部通过                                                    | ✅   | [PR #19 Checks](https://github.com/hzense/tech-intelligence-hub/pull/19/checks)验证生产依赖审计、构建、单测、内容/Seed、双视口 Radar 与真实 pgvector Migration 流程                                                                            |
| Vercel 生产部署与域名                                          | ✅   | [`hzense.com`](https://hzense.com/) 已上线；HTTPS、HTTP → HTTPS 与 `www` → 根域名跳转均已验收                                                                                                                                                  |
| PostgreSQL 生产数据基线                                        | ✅   | 历史基线：PostgreSQL 18.6 / pgvector 0.8.6、13 张表、3 个 Migration / 0 pending 与 62 条 Topic 投影验收通过。后续已升级至 0000–0014 共 15 个迁移／47 张表并独立核验，导入已启用；本轮 0015（16 迁移／48 表）仅完成本地隔离验证，尚未生产迁移。 |
| Runtime Reader 生产接入                                        | ✅   | Production-only 配置、`READY` 部署、真实五列读取、安全日志与小时级工作流首次手工运行均通过独立验收                                                                                                                                             |
| sitemap、robots、canonical metadata                            | ✅   | App Router metadata routes 与页面 canonical 由 PR #9 的 Playwright 测试自动验证                                                                                                                                                                |

## 当前风险与阻塞

| 优先级             | 风险                                               | 处理方式                                                                                                                                     |
| ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P0（ACL 变更门禁） | Runtime ACL 历史恢复证据不足                       | PR #42 工具与 CI 已验收，但禁止再次 normalization；forward-only guard 不替代 provider 备份/恢复核验、生产双 baseline、人工恢复计划或隔离演练 |
| P1                 | 样例内容主要来自 2024 年，无法代表日常更新能力     | 由 organization owner 解除 Actions PR 策略阻塞，再启用变量并验证自动 Draft PR；机器人仍不得 ready/approve/merge                              |
| P1                 | 本轮延期轮换的 Production Runtime 凭据仍属高敏感值 | 既有 handling-exposure risk 已触发但被知情延期，义务仍开放；任何新增暴露/疑似滥用、异常认证或权限主体变化必须升级处理                        |
| P1                 | Neon 保留数据库依赖 provider-owned 默认 ACL        | 当前精确 provider-object 指纹已通过；持续逐库复核，任何 owner、模板标志、ACL、对象定义或间接路径漂移都阻断上线                               |
| P1                 | Provider 侧数据库容量与阈值可观测性仍有限          | PR #40 的有界应用告警已验收；另行建立 Neon PgBouncer client-capacity 及 provider 侧连接、池与数据库阈值监控                                  |
| P2                 | 历史 Hosted Alpha 仍公开                           | 保持 `hzense.com` 为唯一正式站；得到显式授权后改为 owner-only，并验证匿名拒绝。永久删除需另行 destructive 授权                               |

## 进度更新规则

1. 每次合并到 `main` 后更新本看板。
2. 只有可运行、可测试或可访问的结果才能计入完成度。
3. “文档已写”不等于“功能已实现”；“Workflow 已定义”不等于“CI 已通过”。
4. 任务完成必须附带至少一种证据：测试结果、绿色 CI、预览链接、生产链接或可核查文件。
5. Website MVP 完成度以 [MVP Acceptance Criteria](./MVP_ACCEPTANCE.md) 为准。
6. CI 证据必须对应 PR 最终 head commit；合并前最后核对一次，PR 内优先使用始终指向当前 head 的 Checks 链接。

## 更新记录

| 日期       | 更新                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-14 | AI 五表最小授权及独立复核完成，两项 Production Secret 已保存；首次部署的 TLS 配置错误修正后，`main@15ffd409` 第二次部署 READY，管理员页面／列表 API、匿名拒绝及健康验收通过；未保存真实供应商配置或调用模型。            |
| 2026-09-14 | PR #80 合并为 `5a03b1e`，main CI 与 Production 部署成功；独立 ACL 双采集归档、生产升级至 `0013` 并独立核验 14 个迁移／40 张表。域名白名单生效，AI 专用角色及两个 Secret 尚待配置；恢复能力仍未验证，未启用 Signal 发布。 |
| 2026-09-06 | PR #45 合并为 `main@a5a4bca`，合并后 CI 通过、本地 main 已同步；记录完整平台已完成约 55%–65%、剩余约 35%–45% 的粗估口径，补齐六类剩余工作、完成标准和建议顺序；FTS-1 生产上线仍待执行                                    |
| 2026-09-04 | PR #41 FTS-0 通过最终评审、CI、Search `23/23`、Web `3/3` 并合并为 `main@83654c48`；精确 Production 部署、五结果搜索、DB health 与路由日志通过；FTS-1 数据库落地仍待执行                                                  |
| 2026-09-04 | PR #42 修复空 ACL 数组 `22023` 后完整 CI 全绿并合并为 `main@0806e349`；精确 Production 部署/health 通过，未执行生产 ACL 捕获、provider backup 核验或数据库 mutation                                                      |
| 2026-09-04 | PR #40 合并为 `main@0012871`，精确 Production 部署、直接 health、受控单例 incident 与恢复关闭通过；其他检查点风险不变                                                                                                    |
| 2026-09-04 | [运维检查点](./production-evidence/2026-09-04-operations-checkpoint.md)：Continuous Daily 受组织策略 409 阻断；Alpha 仍 public；ACL 恢复证据不足；本轮保留高敏感 Runtime 凭据                                            |
| 2026-09-03 | Runtime Reader 完成 Production-only 配置与 `READY` 重部署；health、真实五列读取、安全日志和小时级工作流首次手工运行均通过；凭据轮换仍待完成，生产就绪度更新为 98%                                                        |
| 2026-09-03 | 验收前检查点：PR #36 已合并并通过 main CI；当时健康任务因仓库变量未设置而按设计跳过，公开探针仍为 HTTP 503，不能视作数据库健康证据                                                                                       |
| 2026-09-02 | PR #36 合并显式 schedule/变量门禁、触发器与 cron 防漂移校验，并保留受控手工验证入口                                                                                                                                      |
| 2026-09-01 | Neon catalog-only 复核确认 Runtime 目标 ACL 与五列 allowlist；脱敏矩阵及查询/结果 SHA-256 已入库，其他上线门禁不变                                                                                                       |
| 2026-08-31 | Runtime Reader 上线前新建七天回滚分支；完成角色/ACL 盘点、Runtime read-only 默认值、`neondb` ambient ACL 隔离，并将维护 Migrator 上限由 5 调整为 10；生产凭据、目标 ACL、Vercel 与健康验收仍待完成                       |
| 2026-08-31 | 新可恢复分支备份、生产 `0002`、3 个 Migration / 0 pending、最小权限 `hzense_topic_sync`、62 个 Topics / 0 unknown、reviewed fingerprint 与 0 变更 no-op 均完成独立验证；Runtime Reader 外部上线仍未执行                  |
| 2026-08-31 | Runtime Reader 准备分支定义 `hzense_runtime` 五列只读边界、Production-only pooled 客户端、Node health、`iad1` 部署配置、Preview/CI fail closed 与安全日志；仓库变更仍待合并和生产验证                                    |
| 2026-08-30 | PR #30 合并完整 Topic 派生投影交付：`0002_topic_projection.sql`、双 fingerprint 同步器、最小权限 `hzense_topic_sync` 配置脚本与 PostgreSQL 18 集成测试进入 `main`；所有生产数据库动作仍为 `not_executed`                 |
| 2026-08-30 | PR #29 合并 Topic 权威链：以 Taxonomy YAML 为 ID / 规范名 / primary parent / 跨域关系权威，Seed 拥有运行时状态，Content 作为本地化页面与完整门禁；PostgreSQL 仍是派生投影                                                |
| 2026-08-29 | 真实 Neon 生产实例保留一份未设置自动过期时间的手动快照，完成 2 个 Migration、13 张表与 0 pending 独立复核；解除 Neon–Vercel 项目连接并确认集成数据库变量均不存在                                                         |
| 2026-08-29 | PR #24–#25 固定 PostgreSQL 18 / pgvector 0.8.6 生产合约与 Neon 代理 TLS 证据                                                                                                                                             |
| 2026-08-29 | PR #19 建立 Radar 评分级证据、精确一手来源、Information Model v2.0.0 与可回滚 PostgreSQL Migration 验证                                                                                                                  |
| 2026-08-29 | PR #18 升级 Next.js / React 安全补丁版本，并在 CI 增加生产依赖审计门禁                                                                                                                                                   |
| 2026-08-27 | PR #17 接入独立 Radar 路由、类型化示例快照、领域/阶段/趋势筛选与 Topic / Signal / Resource 关联内容                                                                                                                      |
| 2026-08-27 | PR #16 接入六类公开内容的关键词搜索、类型筛选、相关度排序、导航入口及桌面/移动端验收                                                                                                                                     |
| 2026-08-26 | PR #15 统一 Seed Schema 与引用校验入口，增加 CI 手动触发并修复进度文档格式                                                                                                                                               |
| 2026-08-26 | PR #12–#14 接入 Weekly、Signals、Resources、类型化 Seed runtime、日期语义校验与实体关系图谱                                                                                                                              |
| 2026-08-25 | PR #11 将已验证的 Topic Markdown 接入列表、动态详情、导航、关联情报、sitemap 与双视口冒烟测试                                                                                                                            |
| 2026-08-25 | PR #10 将已验证的 Insight Markdown 接入列表、动态详情、首页、导航、sitemap 与双视口冒烟测试                                                                                                                              |
| 2026-08-25 | PR #9 建立 canonical、sitemap、robots、错误界面、安全响应头及桌面/移动端 Playwright 发布门禁                                                                                                                             |
| 2026-08-25 | `hzense.com` 正式上线；完成 HTTPS、HTTP → HTTPS、`www.hzense.com` → 根域名、首页与 Daily 路由验收                                                                                                                        |
| 2026-08-23 | PR #7 建立 Vercel Preview 与 Production 自动部署，完成 Home、Daily 动态路由和 Logo 的首次线上验收，并补充部署构建门禁与运行手册                                                                                          |
| 2026-08-22 | PR #6 将经过交叉引用校验的 Markdown runtime 接入 Home 与动态 Daily 路由，并把样例内容统一为中文                                                                                                                          |
| 2026-08-21 | PR #4 完成依赖锁定、frozen install 和 Topic / Entity / Signal / Content 交叉引用校验，Development Foundation 达到验收标准                                                                                                |
| 2026-08-21 | 发布 Web MVP Alpha：完成 Home、Daily、Radar、响应式 Shell、主题与品牌资源，并提供可访问 Hosted checkpoint                                                                                                                |
| 2026-08-20 | 创建首版进度看板；修复 pnpm 11 构建授权与 YAML 日期校验；Foundation CI 首次完整通过                                                                                                                                      |
