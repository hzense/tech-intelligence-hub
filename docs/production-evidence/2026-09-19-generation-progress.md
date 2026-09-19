# AI 生成长任务：生产启用记录

## 范围

2026-09-19 操作者要求保持现有套餐并启用长任务，随后明确允许新建备份、执行 `0019_generation_progress.sql`、补齐三个进度字段的最小 SELECT／UPDATE 权限，并接受恢复尚未演练的风险；维护期间暂停其他生产数据库变更和发布。

模型预算保持每批 5 美元、UTC 日 10 美元。Workflow／Sandbox 基础设施用量与模型预算分开核算。当前团队经 API 确认为 active Hobby；按 [Sandbox 官方配额说明](https://vercel.com/docs/sandbox/pricing)，Hobby 在包含额度内免费，超额暂停创建而非自动升级收费。此结论不代表其它服务免费。不自动重试历史任务，不调用真实模型，不公开发布候选，不轮换密码。

## 当前证据

- 代码：PR #122 已合并，`main@4d983587c4af2531c95c314743caa5cffa7648ed`；[main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/35464361509) 成功。
- [只读预检 35464788280](https://github.com/hzense/tech-intelligence-hub/actions/runs/35464788280) 成功，`pendingMigrationCount: 1`。该次计划使用旧备份绑定，**不能直接用作新备份的迁移审批计划**。
- Neon 当前生产 `main` 已创建包含数据和结构的迁移前备份分支 `pre-generation-progress-0019-2026-09-19`，页面确认创建于 2026-09-19 19:40:13 UTC，到期于 **2026-09-20 19:40:13 UTC**。未升级套餐，未删除旧备份；备份存在不等于恢复已验证。
- 已更新受保护环境的备份标识。没有将数据库密码或连接串下载到本地。
- [ACL 双次只读采集 35465089250](https://github.com/hzense/tech-intelligence-hub/actions/runs/35465089250) 经操作者审批后成功。两次独立采集时间为 19:42:45.414／19:42:47.118 UTC，重建校验后指纹一致：`54f4ae3e62fae282a0f1f10079e4eb066c4061b52974e0b53e14661db3f7ee0a`。附件 `acl-evidence-35465089250-1` 内 JSON 的 SHA-256 为 `149179f505acac7937854af403d6015d3971bf9f83edb837c9a766911187d2df`。恢复仍为未验证。
- 使用当前固定迁移清单及只读预检的真实目标，先完整复现预检旧计划指纹，再以新备份摘要重新计算计划：`6369b85786fd25b7218ee053307b95411b9707d964fc4c426a65ee5c04c31a76`。新备份／目标绑定亦由上述 ACL hosted 运行验证。本地仅作无凭据的确定性计算；实际迁移仍须在 runner 及迁移锁内重验目标、待迁移清单和计划。
- [0019 迁移 35465248045](https://github.com/hzense/tech-intelligence-hub/actions/runs/35465248045) 经操作者审批后成功，2026-09-19 19:46:11 UTC 返回 `migrationCount: 20`、`tableCount: 48`，计划指纹与新备份绑定一致。工作流内完整结构合约检查通过；恢复仍为未验证。
- Neon 生产 `main`／`hzense` 独立只读事务核对通过：当前认证角色为数据库 owner，迁移账本 20 项且最新为 `0019_generation_progress.sql`；`progress_phase` 为 nullable text，`progress_at`／`started_at` 为 nullable timestamptz；待执行任务、运行中任务、未过期租约均为 0。查询以 `ROLLBACK` 结束，没有改写历史任务。
- [独立 hosted 全量核验 35465494594](https://github.com/hzense/tech-intelligence-hub/actions/runs/35465494594) 成功，返回 20 项迁移、48 张表。
- 操作者在权限执行前再次确认。Neon 以已合并 SHA 的完整 `upgrade_generation_progress.sql` 执行，事务 COMMIT 成功；随后独立只读运行相同完整后置合约，`safe=true`，显式列权限总数为 51。无新角色、密码变更、表级权限或业务数据修改。控制台提示仅截断查询历史，不是截断执行脚本；完整脚本来源为固定提交。
- Vercel 项目 OIDC 已启用，运行区域 `iad1`，现有生成开关为 1、模型预算为 5000000／10000000 microUSD。未读取或导出数据库连接、AI keyring 或模型密钥。
- 无 AI 基础设施检查：同一项目创建非持久 Sandbox，Node 24、1 vCPU／2048 MB、30 分钟上限、deny-all 网络策略。固定 Node 版本检查退出码 0；约 37 秒后显式停止并确认 stopped。未传入数据库连接、资料或模型凭据。此项使用 CLI 授权验证资源资格，不冒充部署运行时 OIDC 或完整 Workflow 业务验收。
- 已保存 Production 专用 `HZENSE_GENERATION_WORKFLOW_ENABLED=1`，同一已审核提交重新部署为 `dpl_4Wyp1efZyqnNV17QzdZMRAnaKrQg`，状态 READY。API 确认 Workflow Step `maxDuration=300`、区域 `iad1`、Production OIDC claims；构建日志确认执行 Worker 打包脚本、编译 1 个 Workflow／77 个 steps，并生成 flow／step／webhook 路由。没有通过真实任务验证生产队列投递或运行时 Worker 文件读取。
- 曾发现 `hzense.com` 仍指向旧提交 `909e09f`；新部署 Ready 后已显式 promote，并通过域名 API 回读确认正式域名指向上述新部署，提交为 `4d983587c4af2531c95c314743caa5cffa7648ed`。
- 正式域名首页 HTTP 200；匿名 POST 生成预检接口 HTTP 401。Google 管理员正常登录后，生成页正常读取现有资料、配置及历史任务，显示后台长任务说明和阶段进度条，不再显示生成未启用提示。未创建任务、未重跑旧任务、未勾选资料外发授权。
- 在正式生成页执行只读预检，Production 配置、专用凭据、TLS 验证、身份与数据库目标、只读事务、最小权限合约六项均通过；该部署请求日志确认预检 POST 返回 200。
- 验收窗口最近 100 条请求日志中未发现 HTTP 5xx。有 Node `DEP0169`（`url.parse()`）弃用提示；构建另有 Turbo 环境变量未声明警告，构建仍成功，生产运行时的配置和数据库读取已由上述检查验证。未将这些警告等同于功能失败，也未在本次运维变更中修改依赖或构建配置。

## 尚未完成

1. 另行授权一次受控模型验收，验证生产 Workflow 队列投递、运行时 OIDC、Worker 私有产物读取、模型调用和候选落库的完整链路。本次仅证明配置启用、构建部署、Sandbox 资源资格和只读访问，不将它们等同于真实生成成功。
2. 构建变量声明和 Node 弃用提示可作为后续维护项独立排查，不应通过暴露所有生产密钥给构建任务来消除警告。

当前 `0019` 和最小权限升级已完成，长任务开关已在正式域名生效，无 AI 的上线核验通过；真实模型端到端尚未验收。此次维护操作已结束，可解除本次临时维护冻结；迁移前备份保持原定到期时间，不自动延长。

## 归档 PR 的缓存回归

PR #123 首次预览部署 `dpl_9Ls9kwQVtJpeWj4Vf3UcXzNeBSmq` 命中全部 Turbo 构建缓存，但部署产物时因 `.generation-worker/worker.cjs` 缺失而失败（`ENOENT`）。根因是 Worker 由 Web prebuild 生成并被 Next.js 私有输出追踪引用，却没有列入 Turbo 的缓存输出。

已将 `.generation-worker/**` 纳入构建 outputs，并加入 Worker 缓存／输出追踪合约回归检查。两项定向测试、ESLint、格式检查和生产构建通过；将本地生成的 Worker 移至临时备份后再次构建，三项任务全部命中缓存，Worker 自动恢复且与备份 SHA-256 一致。这项验证不调用模型，也不改变生产开关或数据库权限；预览重新部署结果以 PR 检查为准。
