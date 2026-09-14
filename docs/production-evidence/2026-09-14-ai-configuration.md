# AI 配置生产迁移与启用检查（2026-09-14）

## 当前结论

生产数据库已完成 `0004–0013` 迁移，迁移后核验及独立 `verify` 均确认 14 个迁移、40 张表。2026-09-14 操作者确认专用角色密码已保存，并明确授权五表最小权限及本项目两项 Production Secret 配置；授权事务已提交并独立只读复核，数据库 URL 与根密钥环均已保存为 Production-only Secret。首次部署因 URL 的 TLS 参数不符而配置关闭，修正同一 Secret 后，`main@15ffd409` 第二次部署已 READY；真实管理员页面、正常页面只读 API、匿名拒绝和公开数据库健康检查均通过。后台现已可配置，但尚未验收真实供应商连接保存／加解密、模型能力或 Profile 端到端资格；恢复能力仍未演练。

## 初次检查（迁移前历史）

- [PR #79](https://github.com/hzense/tech-intelligence-hub/pull/79) 已合并，提交 `3a71c1512398d433f7078fc2b7c9380c5f38212e`。
- 对应 [main CI #34787055330](https://github.com/hzense/tech-intelligence-hub/actions/runs/34787055330) 成功。
- Production 部署 `dpl_7Bn8S2p4mpWCLX5WtNYmm9fk4sQN` 为 READY，绑定 `hzense.com`，对应上述提交。
- 管理员浏览器已登录，`/admin/ai` 显示“AI 后台尚未配置完成”和“允许的接口域名：未配置”，表单禁用。
- 初次核对 Vercel Project 的 All Environments 列表时，未配置 `HZENSE_AI_DATABASE_URL`、`HZENSE_AI_KEYRING`、`HZENSE_AI_ALLOWED_HOSTS`；只核对名称和环境范围，没有读取现有 Secret 值。
- 随后已通过 Vercel 页面保存 Production-only Config `HZENSE_AI_ALLOWED_HOSTS=ai-gateway.vercel.sh`，成功提示及环境范围已核对。该时点尚未重新部署，后续部署及白名单生效结果见下文；专用数据库 URL／根密钥环仍未保存。

## Neon 迁移前只读核验

在现有生产项目的 `main` 分支、`hzense` 数据库执行 `BEGIN READ ONLY`，结束 `ROLLBACK`；没有写数据、修改 ACL 或密码。

| 检查         | 结果                                                                              |
| ------------ | --------------------------------------------------------------------------------- |
| 实际身份     | `hzense_migrator`                                                                 |
| PostgreSQL   | `18.6`                                                                            |
| 迁移账本     | `0000–0003` 共 4 条，checksum 与当前仓库一致                                      |
| AI 表        | 0 张                                                                              |
| AI 专用角色  | `hzense_ai_admin` 不存在                                                          |
| 现有连接限制 | Migrator 10，Runtime 20，未修改                                                   |
| 其他库       | `neondb` 没有 PUBLIC 数据库授权；`postgres`／`template1` 符合既有 Neon 保留库边界 |

独立的 [hosted preflight #34792736107](https://github.com/hzense/tech-intelligence-hub/actions/runs/34792736107) 在同一 main SHA 通过 Environment 审批后成功，最终输出 `pendingMigrationCount: 10`。它是只读预检，不是迁移或授权。

## 本次批准及备份

操作者已明确同意：保留新的生产备份，接受恢复能力尚未演练的风险，升级 `0004–0013` 并授权仅访问五张 AI 私表的专用角色；不启用 Signal 自动发布、不切换网站数据源。此同意不伪装成恢复验证证明。

Neon 已创建 `pre-ai-config-20260914`，选择当前 `main` 的 **Branch data and schema**，自动删除设为七天。创建结果页确认 parent 为生产 main、创建时间 `2026-09-14 02:30:11 GMT+2`、到期 `2026-09-21 02:30:10 GMT+2`。真实分支 ID 仅用于受保护审批绑定；本记录不公开连接串。分支存在、目标及期限已核对，但没有执行恢复演练，`backupVerified`／`restoreRehearsed`／`aclRecoveryReviewed` 仍为 false。

提交前本地验证：整仓单元测试、lint、类型、格式及工作流校验通过；完整原生 PostgreSQL 集成 469 项通过，包含 AI 角色 77 项及实际迁移 SQL 快照绑定回归；配置组件→HTTP→真实受限 PostgreSQL 浏览器回归 7 项通过。迁移门禁与 ACL 由独立代理只读复核，无剩余确定阻断项。一次性本地夹具结束后已恢复其保留库 PUBLIC 有效权限、临时数据库及角色零残留；没有修改历史本地开发库或生产 ACL。这些本地结果与下述实际线上执行分开记录。

## 批次代码、部署与预检

- [PR #80](https://github.com/hzense/tech-intelligence-hub/pull/80) 已合并为 `5a03b1e39f90a0e4ccdfb67979169f2a5233e73a`，[同 SHA main CI #34793904068](https://github.com/hzense/tech-intelligence-hub/actions/runs/34793904068) 成功。
- Production 部署 `dpl_F4FUpDLQVPMtwSwKVACvW1zFRDvF` 为 READY，绑定 `hzense.com`，对应上述提交。
- 重新通过真实 Google 管理员登录访问 `/admin/ai`，确认允许域名已显示且白名单生效；后台仍提示未配置完成，表单禁用，没有调用供应商。
- 新的 [preflight #34794059431](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794059431) 成功，输出 `pendingMigrationCount: 10`，用于审核该 SHA 的精确迁移计划。

本次审批绑定的指纹：

| 范围                                 | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| 固定迁移工件 `manifestFingerprint`   | `821f317947c6c0234a7e16caf10423a5431e791a228cc752a81fac33b6aa2654` |
| 本次十项待执行计划 `planFingerprint` | `444fc7540b0fc9a36650ed6415d742c8d04e0ba7e49344860862d4f9074b3893` |
| 迁移前双采集 ACL 基线                | `d0ec28b658faf111413b82cab5447787d4d7edfaf653cd486a27f7726493e100` |

它们标识不同对象，不是备份可恢复或服务已可用的证明。完整审批及原始备份 ID 仅保存在受保护环境中。

## ACL 双采集及审核

首次 [acl-capture #34794132133](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794132133) 因审批遗漏 `backupPresenceReviewed`，在连接数据库前被门禁拒绝；没有产生成功基线或数据库写入。补齐真实备份存在性声明后，使用新的运行及独立审批，不复用失败 run。

[acl-capture #34794203356](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794203356)，attempt `1`，成功完成。原始附件归档为 [baseline.json](acl/34794203356-1/baseline.json)，两份内层基线重建、执行身份、SHA／run／attempt、指纹及脱敏检查通过；11 类目录一致，均得到上表 ACL 指纹。详细来源、文件摘要和残余限制见[审核记录](acl/34794203356-1/review.md)。附件明确记录 `accept-unverified-ai-config`、`recoveryVerified: false`，没有恢复 SQL 或演练通过结论。

## 生产迁移与独立核验

| 运行                                                                                                       | 结果与边界                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [migrate #34794365453](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794365453)           | 成功应用 `0004–0013`，迁移内最终 Schema 核验为 `migrationCount: 14`、`tableCount: 40`；返回的 manifest／plan 指纹与预检一致，恢复状态仍为未验证。 |
| [verify #34794509473](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794509473)            | 独立只读运行成功，输出 `migrationCount: 14`、`tableCount: 40`，不是仅依据迁移任务成功推定。                                                       |
| [runtime-preflight #34794586203](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794586203) | 使用 Runtime 自身凭据独立只读预检成功，最终为 `operation: runtime-preflight`、`status: succeeded`；未扩大其既有权限。                             |

迁移后公开数据库健康端点 `/api/health/database` 实测 HTTP `200`、精确正文 `{"status":"ok"}`。这证明该次健康探针成功，不能替代完整 Runtime 最小权限核验或 AI 专用连接验收。

本批使用独立 `accept-unverified-ai-config` 策略及精确 run-bound 审批。迁移器在持锁后校验真正执行的冻结 SQL 工件及计划，不复用 FTS-1 豁免；逐文件事务不是整批原子事务。本次成功结果不授权未来迁移或再次重放已完成的空计划。

## 待执行边界

上述生产维护运行均已结束，没有仍在执行的数据库任务。剩余工作：

1. 管理员另行提供供应商 API key，按明确授权保存真实连接并验收凭据加解密；本轮只完成配置基础设施和空状态页面／API 验收，没有保存供应商连接或 Profile。
2. 模型发现、真实能力测试、用量／未知结果核对及 Profile 就绪仍需独立验收；其中模型发现会登记记录并访问供应商，能力测试可能计费。AI 页面及测试记录 GET 在有超时 `pending`／`running` 时可能写为 `unknown`，不笼统视为纯读取；本次授权后独立检查三类记录均为 0，没有发起任何测试。
3. 后续新增维护或业务写入仍须独立授权，并复核适用的备份保留期及维护窗口；不将本批迁移或授权成功当作恢复能力证明。

本轮不轮换既有凭据，不建立本地生产 `.env`，不触发付费模型测试。供应商 API Key 由管理员在可用页面中添加；页面可配置、连接可保存、真实模型能力测试以及 Profile 就绪分别验收。

Signal 新读取模式、自动发布和采集任务保持关闭。新增角色或根密钥不写入仓库，本文不保存密码、数据库连接串、Cookie、完整变量值或原始错误。

## 新角色创建重试检查

操作者反馈 Neon 点击 Run 失败。原标签页已关闭，重开仅恢复查询文本，没有保留原错误结果，因此不把推导的故障点写成已捕获的线上错误。随后执行单条只读诊断：`neondb`／`neondb_owner` 身份正确，拥有 `CREATEROLE`，`hzense_ai_admin` 不存在，随机 UUID 与 SHA-256 内置函数存在。该检查没有创建角色、输入密码或授予权限。

准备脚本存在确定的不兼容：PostgreSQL 18 的非超级用户创建者会收到 bootstrap superuser 的 ADMIN-only 管理关系，创建者不能自行撤销；原脚本的 REVOKE 不会移除它，随后“任何成员关系均拒绝”的检查无法通过。本地隔离 PostgreSQL 18.4 已复现 REVOKE 仅产生 warning、管理边仍存在；复现事务回滚，测试角色零残留。这不是业务表、数据库迁移或旧密码故障。

修复候选只接受 `cloud_admin` 授予 `neondb_owner` 的精确 ADMIN-only 入向管理边，禁止其他入向及全部出向成员关系。新建凭据与五表授权继续拆开，前者由管理员提交；已有角色直接拒绝，不重置密码。详见 [AI 配置契约](../AI_CONNECTIONS.md)。

本地原生 AI 角色套件 104/104 通过，新增 27 项覆盖创建候选提交／回滚、SCRAM、事务设置恢复、已有角色拒绝及旧密码 verifier 不变、精确管理边、授权前后拒绝异常成员关系及授权后角色属性漂移。隔离创建测试仅映射本地身份／数据库／bootstrap grantor，不能证明 Neon 分支身份。整仓单元、lint、typecheck 均绕过缓存重新通过，格式与差异检查通过，独立只读安全复核无阻断；测试集群临时库／角色零残留，PUBLIC 权限已恢复。

修正后的完整脚本当时已重新填入 Neon `main`／`neondb` 页面，并核对与候选一致；自动化没有点击凭据创建 Run。该准备时点尚待 PR 交付及真实 Neon 执行，不代表角色或服务已启用；后续已确认状态见下一节。

## 专用角色授权与 Production Secret 配置

[PR #82](https://github.com/hzense/tech-intelligence-hub/pull/82) 已交付至 `main@15ffd409`。本阶段开始时 `hzense_ai_admin` 已存在；2026-09-14 操作者明确确认密码已保存，并允许对该现有角色授予五表最小权限、在本项目 Vercel Production 保存 AI 专用连接与根密钥环。本阶段没有新建角色、修改或重置任何密码，也没有再次执行迁移。

授权前只读检查确认角色为 `LOGIN NOINHERIT CONNECTION LIMIT 2`，所有高权限属性为 false；唯一成员关系是 `cloud_admin` 将 `hzense_ai_admin` 授予 `neondb_owner`，`ADMIN=true`、`INHERIT=false`、`SET=false`。角色设置及直接 ACL／所有权依赖均为 0，目标库及 `neondb` 无 CONNECT／CREATE／TEMPORARY 权限；`postgres`／`template1` 仅保留已审核的精确 provider 权限边界。

在 Neon 浏览器中核对生产 `main`／`hzense`、实际身份 `hzense_migrator`，执行与 `db/roles/configure_ai_admin.sql` 等价的去注释内容，共 19 条语句，包含提交前两个 DO 守卫。结果界面显示第 19 条为 `COMMIT`，并显示 `Statement executed successfully`。随后以独立只读查询复核：当前库 CONNECT=true、CREATE／TEMPORARY=false，直接表级／序列级 ACL 数为 0；列级权限计数如下，全部 `grant_option=false`。

| 表                       | SELECT 列数 | INSERT 列数 | UPDATE 列数 |
| ------------------------ | ----------- | ----------- | ----------- |
| `ai_connection_versions` | 4           | 4           | 0           |
| `ai_connections`         | 10          | 10          | 8           |
| `ai_probe_runs`          | 16          | 16          | 8           |
| `ai_profile_versions`    | 4           | 4           | 0           |
| `ai_profiles`            | 6           | 6           | 4           |

精确列白名单由已审核脚本及提交前守卫约束；上述独立查询另行确认权限数量和不可再授权，不以数量单独替代完整 ACL 契约。连接、Profile、测试记录计数均为 0，没有写入业务配置或调用供应商。

Vercel 页面已分别确认 `HZENSE_AI_DATABASE_URL`、`HZENSE_AI_KEYRING` 保存成功，均为 Secret、仅 Production 范围，原域名白名单保留。独立根密钥由 Web Crypto 安全随机生成 32 字节，只在内存中处理后提交到受保护 Secret；没有写入本地文件、数据库或聊天。本记录仅保存变量名称、范围与结果，不记录密码、根密钥、连接串、原始主机名或完整变量值。

首次配置后的 Production 部署 `dpl_9jQoXKp4o3nahAoyH1ETmtMCpipd` 已 READY，对应 `main@15ffd409`，alias 包含 `hzense.com`；但真实管理员登录后页面仍为 `configured=false`，不能将这次 READY 记为 AI 可用。已确定初次数据库 URL 使用 Neon 默认 `sslmode=require`、`channel_binding=require`，而应用沿用的目标／TLS 契约要求 `sslmode=verify-full`、`channel_binding=prefer`，因此配置校验拒绝。

仅本地合成配置解析复核通过：测试专用假主机／密码、独立随机 32 字节密钥环及显式目标绑定，确认 `require/require` 被拒绝、`verify-full/prefer` 通过。该检查没有读取真实环境 Secret、访问网络或连接数据库，只证明参数校验行为，不替代生产连接验收。

同一数据库 URL Secret 的 TLS 参数已修正并保存；密码、角色、主机、端口 5432 和数据库均保持不变，根密钥环保留。随后触发第二次 Production 部署，完成结果见下一节。没有调整 Signal 新读取、自动发布或采集开关，也没有配置供应商 API key、发起模型发现／付费测试或保存 Profile。

## 配置后部署与最小验收

第二次 Production 部署 `dpl_7i7Kn5KhRrj3Rqa3qGp9tKog2BfH` 已 READY，对应完整提交 `15ffd409b686d5945acb8ca5c79fb1788bc42294`，alias 包含 `hzense.com`、`www.hzense.com`。创建时间为 `2026-09-14 08:36:56.897Z`，READY 时间为 `2026-09-14 08:38:12.257Z`。该结果与首次 READY 但配置关闭的部署分别记录。

| 验收项               | 已观察结果                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/ai`          | 指定管理员真实 Google 登录后，“AI 后台尚未配置完成”提示消失；新建、名称、API key 和保存控件均启用。首次水合的会话存储提示随后自动消失。未输入或保存真实供应商凭据。 |
| `/admin/ai/profiles` | 表单可编辑，新建和保存按钮启用；点击“刷新状态”成功显示配置状态与连接修订已刷新的提示。没有保存 Profile。                                                            |
| 正常页面 API         | 仅限定该部署的日志在 `08:39:51Z` 确认 `GET /api/admin/ai/connections` 与 `GET /api/admin/ai/profiles` 均为 200、cache MISS；浏览器 error／warn 采集为空。           |
| 直接导航的拒绝       | `08:39:28Z` 直接导航连接 API 曾返回 403；未绕过 GET Fetch Metadata 防护，改用正常页面刷新后两个 GET 均通过。                                                        |
| 匿名 API             | 两个列表接口最终均返回 401，均带 `Cache-Control: private, no-store`。                                                                                               |
| 公开数据库健康       | `/api/health/database` 返回 200、精确正文 `{"status":"ok"}`，并带 `Cache-Control: no-store`；该探针检查 Runtime，不代替 AI 模型健康验收。                           |
| 有界错误日志         | `2026-09-14T08:25:31.255Z–2026-09-14T08:40:31.255Z` 范围内 error／fatal 扫描无匹配；仅作为该窗口结果，不外推全站或长期无错误。                                      |

以上证明服务端配置已被当前部署接受、AI 专用连接的页面读取可用，并保持匿名拒绝边界。它不证明真实供应商连接可保存、已验证根密钥加解密、模型兼容／计费或 Profile 端到端资格。本轮没有创建／保存真实供应商连接或 Profile，没有模型列表／能力调用，也没有开启自动采集、Signal 新读取或自动发布。

## OpenRouter 域名授权与表单改进

后续操作者填写 OpenRouter 连接时，生产日志在 `10:12:36Z`、`10:14:00Z`、`10:16:31Z` 均记录 `POST /api/admin/ai/connections` 返回 400，对应 `main@30c5820` 的部署。只读页面确认当时允许域名只有 `ai-gateway.vercel.sh`；填写的 OpenRouter 域名不在其中。原表单还曾使用完整 `/chat/completions` 请求路径；这不是该次白名单拒绝的原因，但会使后续程序追加错误路径。

用公开地址和合成参数进行本地校验，确认旧白名单拒绝 OpenRouter，加入精确域名后接受 `https://openrouter.ai/api/v1`；该检查没有读取真实凭据、连接数据库或访问供应商。`createAiConnection` 在数据库事务前执行此校验，不能将该 400 当作 Neon 故障或供应商密钥无效。

操作者明确要求修改并加入 `openrouter.ai` 后，线上只更改本项目的 Production Config `HZENSE_AI_ALLOWED_HOSTS` 为 `ai-gateway.vercel.sh,openrouter.ai`，保留原域名及其它环境变量，没有更改密码、数据库授权或供应商凭据。Vercel 明确显示保存成功，随后对现有 `main@30c58200a67be8bf1f34759fd533e4181fd9f736` 重新部署：

- 部署：`dpl_HBQmzYE2CbA1S3NbVrwsJq6a7xUk`，Production READY，绑定 `hzense.com`／`www.hzense.com`。
- 创建：`2026-09-14T12:34:09.820Z`；READY：`2026-09-14T12:35:25.034Z`。
- 新的真实管理员页面已显示 `ai-gateway.vercel.sh、openrouter.ai`，连接表单启用；没有提交表单或点击模型测试。
- 操作者原页面已自行修正基础地址为 `/api/v1`；该页面及未保存内容保留，不刷新、不复制或提交 API key。

同批代码改善供应商预设、未授权域名和误填请求端点的提示。预设不构成服务端授权；更换目的端点时清空当前输入密钥，需用户重新输入；不自动保存或调用。代码的测试、PR、合并后生产部署结果在对应 PR 留存，不能用上述旧代码重新部署代替新 UI 上线证明。真实供应商连接保存、加解密、模型能力与 Profile 资格仍未验收。
