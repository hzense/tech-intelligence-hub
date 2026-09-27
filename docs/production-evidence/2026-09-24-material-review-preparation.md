# 通用材料人工确认与独立核验：生产准备记录

记录日期：2026-09-24。只记录可区分的代码、测试及生产证据，不包含凭据、原文、真实连接串或私钥。

归档说明（2026-09-27）：本文是当时的操作快照，不证明当前生产配置或后续核验状态；归档不补做本文所列的待办操作。

## 2026-09-24 生产启用续记

- PR #158 已合并；当时 main 为 `09e5bc702eca4ff069abb01469733d649a4d174d`。以下初始准备状态保留为历史快照，不代表最新进度。
- 新 main 的只读 [preflight 36041382528](https://github.com/hzense/tech-intelligence-hub/actions/runs/36041382528) 成功，当时待迁移数为 2。
- 操作者明确确认本批 0023／0024 迁移、两个专用角色的最小权限及签名配置，并接受恢复未演练时可能的数据损失或较长停机风险；维护期间暂停其他 DDL、ACL 和生产发布。本授权不包括 AI 调用或自动发布信号。
- Neon 已创建 `pre-material-review-0023-0024-2026-09-24`，父分支为生产 main，选择复制当前数据与结构；备份分支 ID 为 `br-fragrant-lab-avtam9az`。控制台确认创建成功，保留至 `2026-10-01T18:32:49Z`。这只验证备份存在与保留时间，不证明已演练恢复。
- 本批备份引用已写入受保护环境。只读 [ACL 采集 36042085731](https://github.com/hzense/tech-intelligence-hub/actions/runs/36042085731) 审批后成功；两次独立采集一致，下载附件并按代码合约重建校验通过。基线指纹为 `aafa42c4a5926c9a8d350df53eb66be5305f9fe4a5fb3a580f1d32c666bb026e`，恢复状态仍为 `unverified-risk-accepted`。
- [迁移任务 36042859337](https://github.com/hzense/tech-intelligence-hub/actions/runs/36042859337) 已获审批并成功，输出 `migrationCount: 25`、`tableCount: 57`。授权精确绑定当前 SHA、运行 ID／attempt、本批备份与 ACL 基线，只允许 `0023_candidate_materials.sql`、`0024_material_review_proposals.sql`。实际输出计划指纹 `966dd1d93b2689606be926405a08c25b5b073b97f4f32783e9089a764d38d377` 与批准一致；恢复能力仍未演练。
- 独立只读 [verify 36043572178](https://github.com/hzense/tech-intelligence-hub/actions/runs/36043572178) 审批后成功，独立确认 `migrationCount: 25`、`tableCount: 57`；不再次迁移、不授权、不调用 AI。
- Neon main／hzense 的独立只读检查确认：当前直接会话为数据库 owner，迁移记录为 25 项，两个 material 专用角色均不存在（计数 0）。下一步才执行角色创建与最小权限脚本，尚未授予新访问权。
- 操作者在执行前再次确认两个角色的最小授权。首次在 `hzense` owner 会话执行创建脚本时，被 `rolcreaterole` 检查拒绝；已回滚。只读检查确认同一 main 分支 `neondb` 的直接 owner 会话拥有创建角色权限，且 material 角色仍为 0；随后以该管理员执行仓库原始创建脚本，9 条语句成功并 COMMIT，未扩大既有 migrator 权限。
- 切回 `hzense` 后，依次执行固定提交中的 `configure_material_registration.sql`（43 条语句，COMMIT）及 `configure_material_review.sql`（15 条语句，COMMIT）。两个文件均确认与本地已评审代码生成器一致，网页取得的完整 SQL 与仓库内容长度和校验值匹配，不采用截断的可见代码行或查询历史重放。
- 在独立只读 SELECT 中执行 `materialRoleCheckSQL(role,{session:false,proposals:true})` 的精确合约：`hzense_material_registrar` 与 `hzense_material_verifier` 均返回 `safe=true`。对应允许矩阵分别为 126／89 项列权限；检查还涵盖额外权限拒绝、连接上限、成员关系、对象所有权、保护函数及 ALWAYS 触发器。此为 owner 读取的有效权限核验，不冒充新角色凭据连接验收。
- 两角色以 `PASSWORD NULL` 创建，未设置新密码，未修改任何现有角色密码。当前功能尚未启用；未执行 AI 或发布。后续完成新角色凭据、Vercel／GitHub 签名及开关配置、合成资料验收。
- 操作者随后确认已设置并保存两个新角色密码；此处仅记录用户确认，不记录密码，也不视为新角色连接验收。继续配置时，Chrome 中的 Vercel 会话显示登录页，已保留页面待操作者登录；本轮尚未新增环境变量、签名配置或部署，功能启用与端到端验收仍待完成。
- 操作者登录后，已在 Vercel 项目 `tech-intelligence-hub-web` 环境变量页面核查：搜索 `HZENSE_MATERIAL_` 无结果。已准备 registrar／verifier 两个数据库变量的新增表单，类型为 Secret、范围仅 Production；值保持空白，交由操作者填写完整连接串并保存，尚未提交或重新部署。
- 操作者保存后，页面与 CLI 元数据均确认两个连接变量为 Production Secret；操作者部署 `dpl_E58iWLAfD7bDvKEpo3iYEofysHEP` 已 READY 并绑定 hzense.com，不读取 Secret 明文。
- 已创建 GitHub `material-verification` 受保护 Environment：仅允许 `main` 分支，要求指定维护者人工审批。该环境保存签名私钥及独立 Worker token；Vercel Production 仅保存对应公钥映射与同一 Worker token。生成与跨服务保存通过进程内存及标准输入完成，不落本地凭据文件、不回显秘密。Ed25519 密钥对自检通过，公钥 SHA-256 为 `ac5da9b807202e1965bad54bbe52cfe2d9aa62a022c01ac9f0c9088f2c841d44`；key ID 为 `material-review-2026-09-24`，verifier ID 为 `hzense-github-material-verifier-v1`。
- 配置 `HZENSE_MATERIAL_REVIEW_ENABLED=1` 使用已升级的精确 ACL 合约；`HZENSE_MATERIAL_REGISTRATION_ENABLED=0`、`HZENSE_MATERIAL_EXECUTOR_ENABLED=0` 继续关闭写入与执行。专用派发 token 尚未配置，已另行请求仅该仓库 Actions 读写／30 天的授权；未借用当前管理员的广域 token。
- 确认当前 main CI 成功后，按固定提交重新部署配置：[部署 7w3jJ2MG9U8KeL2c1NjyrQaG7sLC](https://vercel.com/zhenghu25-6909s-projects/tech-intelligence-hub-web/7w3jJ2MG9U8KeL2c1NjyrQaG7sLC) 已 READY，Production、Next.js、提交 `09e5bc7`、构建约 118 秒，hzense.com／www.hzense.com 别名已绑定。材料 API 在本轮时间范围的错误扫描未发现运行错误；未核查日志 Drains，未据此声称端到端验收通过。
- 管理员登录后仅查看已有候选，完整刷新最新生产页面及补证状态，仍显示“通用补证存储尚未配置”。按 `materialRegistrationConfigured()` 路径，此结果说明 registrar 连接配置检查未通过，尚不能声称数据库认证或角色会话验收成功。未读取已保存 Secret 明文，不能断言具体字段错误；核对代码确认要求与已有 Runtime 目标一致的 pooled host、显式 `:5432`、数据库 `hzense`、对应专用用户名及 `sslmode=verify-full&channel_binding=prefer`，禁止额外参数／空白。已打开 registrar 编辑区域供操作者核对两个 URL；没有轮换密码、重试写任务或调用 AI。
- 操作者更正两个 URL 后，页面元数据确认两项均为已更新的 Production Secret，并自行启动 [部署 4SE2GJnviXZrNB6VVz3MDRSdNJJJ](https://vercel.com/zhenghu25-6909s-projects/tech-intelligence-hub-web/4SE2GJnviXZrNB6VVz3MDRSdNJJJ)。本轮未重复部署；该部署已 READY，Production／Next.js／同一 `09e5bc7` 提交，构建约 141 秒，hzense.com 与 www.hzense.com 均已绑定。
- 新生产部署的已登录候选页只读验收通过：补证区域显示“写入未启用，只读查看已保存材料”，不再显示未配置。结合 `readMaterialDashboard()` 与 `materialPool('registrar')` 路径，这证明 registrar 的真实连接、精确角色检查及材料读取成功；不代表 verifier 角色会话、签名报告写入、登记或发布已验收。页面显示暂无可用公开链接资料。GitHub 执行器开关仍为 `0`；未创建请求、未派发任务、未调用 AI。当前材料 API 错误扫描未发现运行错误，Drains 未核查。

## 补证写入开关启用与页面验收

- 操作者明确要求“现在开启”后，仅将 Vercel Production 的 `HZENSE_MATERIAL_REGISTRATION_ENABLED` 更新为 `1`；未改凭据、数据库权限或其他开关。
- 从已上线提交 `09e5bc702eca4ff069abb01469733d649a4d174d` 重新部署，不上传本地工作区。[部署 FVDNtzWMqAZdyH91F2kTCxygqT2C](https://vercel.com/zhenghu25-6909s-projects/tech-intelligence-hub-web/FVDNtzWMqAZdyH91F2kTCxygqT2C) 已 READY，Production／Next.js，构建约 99 秒，hzense.com／www.hzense.com 别名已绑定。
- 刷新已登录候选页面后，“写入未启用”提示消失；已解析公开来源复选框可勾选，勾选后“确认建立补证请求（不调用 AI）”按钮可用。仅验证前端选择状态，未点击提交、未建立请求、未调用 AI、未登记或发布信号；不据此声称写入与核验闭环已通过。
- GitHub `material-verification` 的 `HZENSE_MATERIAL_EXECUTOR_ENABLED` 实查仍为 `0`；独立核验执行器未开启。后续仍须逐项准备材料、人工确认并启动受保护核验任务。

## 初始准备状态（历史快照）

- 基础 [PR #157](https://github.com/hzense/tech-intelligence-hub/pull/157) 已合并，main 提交 `c3ed01efd84009d211961cd5562035f858591d6f`，Production READY 并绑定 hzense.com。这只证明基础代码部署，不代表通用补证生产已启用。
- 操作者批准的只读 [preflight 36022413674](https://github.com/hzense/tech-intelligence-hub/actions/runs/36022413674) 成功。运行基于旧 main，当时待迁移数为 1（`0023_candidate_materials.sql`）；它不迁移、不授权、不调用 AI。
- 本批新增 `0024_material_review_proposals.sql`，当前尚未提交／合并／部署。仓库目标为 25 迁移／57 表；生产仍待本批重新预检与独立核验，不能用目标计数替代结果。
- 本批未执行生产 DDL、角色授权、凭据配置、AI 调用、登记或发布。

## 操作者选择的工作方式

规则整理原候选与已有、经原文证据校验的 AI 补全结果，产生未可信材料提案；网页展示证据与六项确认，操作者无需填写 JSON、ID 或主张。确认保存后，独立 GitHub 执行器按精确 `request_id + approval_id` 读取已确认材料，安全重抓来源并核对原句，随后生成签名报告；网站只验签与保存，登记及正式发布继续分别确认。

该执行器不调用 AI。页面证据匹配不等于事实真实性或引用许可自动成立，签名依赖操作者实际核对的六项结论；材料不足继续阻断。

## 本地验证边界

提交前本地验证：数据库测试 2322 项通过、672 项因本地无专用 PostgreSQL 实例跳过；Web 测试 595 项通过、11 项跳过；浏览器测试 1 项通过。全工作区 lint、类型检查、格式检查及 Next.js 生产构建通过，独立执行器最终复核未发现剩余 P1／P2 问题。新增隔离 PostgreSQL 回归已纳入现有 CI 套件，涵盖精确新增 ACL、跨 owner／哈希外键、确认人约束、追加式触发器及越权拒绝。最终 PR 的精确 SHA、远程 CI、真实 PostgreSQL 结果及部署须另行追加，不把这些本地结果当作生产验收。

执行器以 `request_id`、`approval_id` 双 UUID 精确绑定本次人工确认；只读 inbox 保留所有活跃、已完成的请求，不因已有旧报告排除请求，支持同一请求产生新提案后的再次确认。派发只处理指定确认，不批量消费 inbox。

## 初始准备时列出的生产启用步骤（历史快照）

1. 完成本批 PR 评审、CI、合并及精确生产部署核对。
2. 对新 main 重新只读 preflight。若生产仍只到 0022，预期待执行 `[0023,0024]`；若已独立执行 0023，则只允许 `[0024]`。任何其他序列保持阻断。
3. 绑定本批新备份、维护冻结声明、实际 pending 与目标指纹；另行批准 `accept-unverified-material-review`／`material-review-production-launch` 风险范围。旧 0022／0023 批次批准不可复用，恢复能力未演练的边界仍保留。
4. 获批后执行迁移及独立 verify；再分别批准受限角色配置、0023 基础权限和 `configure_material_review.sql` 的两表增量 ACL，不扩大 Runtime／Publisher 等既有角色权限。
5. 配置独立 GitHub 受保护环境、公钥和最小 token：签名私钥仅在 GitHub `material-verification` Environment；网站只有公钥和第一方 Worker／派发凭据。所有真实值不入仓库，新凭据与授权另行确认。
6. 默认关闭的 `HZENSE_MATERIAL_REVIEW_ENABLED` 与 `HZENSE_MATERIAL_EXECUTOR_ENABLED` 经配置核验后才开启，同时确认 registration 写入开关。用一条已批准的合成材料完成提案、人工确认、独立执行、报告保存及登记回执闭环；不自动发布。

0023–0024 SQL、角色脚本、真实生产权限和页面验收是不同证据。上述清单是初始准备时的快照；后续已执行事项见本文“生产启用续记”，未列明的核验与发布闭环仍不得视为完成。
