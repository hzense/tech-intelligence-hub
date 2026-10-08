# 统一 Signal 结构迁移验收

2026-10-08 更新：生产已完成 `0030_unified_signal_cutover.sql`、统一 Signal 回填、最小业务授权和独立只读核验，确认 **31 项迁移、62 张表、114 条 Signal、120 个版本、112 条公开信号**。网站已切读统一视图，首次完整对比发现资源链接兼容差异，修复和最终验收进行中；以下首先保留 10 月 7 日仅结构升级的历史记录，10 月 8 日续跑结果见文末。

## 受保护运行

下列维护运行均绑定 `main@eb9989ebf950a6347e7778d5e73abdfbabeaafd1`，并经 `production-maintenance` 环境人工审批；CI 为该提交的独立前置检查。生产写入仅由受保护工作流执行，没有使用本地生产连接执行 SQL。

| 阶段           | 运行                                                                                    | 结果                                           |
| -------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 当前提交 CI    | [37488519564](https://github.com/hzense/tech-intelligence-hub/actions/runs/37488519564) | 成功                                           |
| 迁移前只读预检 | [37490743438](https://github.com/hzense/tech-intelligence-hub/actions/runs/37490743438) | 成功，1 项待迁移                               |
| 双次 ACL 采集  | [37641517185](https://github.com/hzense/tech-intelligence-hub/actions/runs/37641517185) | 成功，两次附件重建指纹一致                     |
| 0030 迁移      | [37646627663](https://github.com/hzense/tech-intelligence-hub/actions/runs/37646627663) | 成功，15:49:13 UTC 输出 31 项迁移、62 张表     |
| 独立只读核验   | [37647191968](https://github.com/hzense/tech-intelligence-hub/actions/runs/37647191968) | 成功，15:51:49 UTC 再次确认 31 项迁移、62 张表 |

0030 文件 SHA-256：`04a114a2f38037e60e97be2057e14ce69b07368b53f33cd4e059be0b5bf09469`。工作流汇总 API 的部分步骤状态曾滞后；迁移及核验结论同时依据完成状态和对应 job 原始日志中的成功结果，不以步骤界面缓存代替执行结果。

## 备份和恢复验证

- 本轮使用新的生产备份，在隔离子分支完成已提交数据、结构及权限变更后的恢复测试。生产 main 和备份源未参与测试写入。
- 恢复前后逐字段比对 61 张 public 表、742 行，以及结构和 ACL 各 21 类目录摘要；目标恢复后与源完全一致。新 timeline、测试 schema 消失和测试权限恢复均通过核验，备份源最终复查也未变化。
- 先前 Reset 因项目分支数达到上限而失败；释放名额后才恢复成功。失败尝试不计作成功证据。
- 经用户确认，演练副本已永久删除，完整证据保留在私有本地归档。备份自动到期恢复为 `2026-10-13T16:00:00Z`；Neon 界面按分钟设置，比原始秒级期限早 28 秒，仍覆盖维护窗口。
- 恢复归档包含 41 份文件，逐文件大小及 SHA-256 复核通过。清单 SHA-256：`8c7b2c55430680a220da37df9a7fe9112119727d009fb48fc0c8ef44535f81a0`。
- 受保护备份引用 SHA-256：`4590622bba559e57d19365cc5e318e710733bde313d28cb42fe1647d1af38868`。本记录不公开原始分支、主机、连接字符串或凭据。

## ACL 审核与变更范围

附件 `acl-evidence-37641517185-1` 的两次独立只读采集时间为 `15:42:29.120Z` 和 `15:42:30.180Z`。按仓库基线契约重建后，指纹均为 `59548de8fb90860b4f805f8c8c76701a98388da0caa7f75f4b400445e66438de`，运行、提交和备份散列绑定通过。

0030 新增默认 `ready=false` 的控制表、可空 `unified_content` 输入列、三个函数、两个触发器及两个公开视图。新对象撤销 PUBLIC 权限，不增加业务角色授权，不回填 Signal，不激活切换。

本次独立 `verified migrate` 不在执行前重比当次 ACL 指纹；安全依据为新鲜双采集、持续维护冻结、已核验恢复证据及迁移后的精确 Schema verifier。不能将它描述为 `migrate-and-verify` 序列入口的 ACL 指纹锁定。提交未知时仅运行独立核验，不盲目重放迁移。生产恢复或后续新增授权须重新审核。

## 网站检查与后续工作

- 数据库健康接口返回 HTTP 200 和 `{"status":"ok"}`；首页、信号列表均为 HTTP 200。
- 公开列表仍包含 112 个不同信号 ID，排序后 JSON 的 SHA-256 仍为 `9a3f54b787280ead62462d78a165460ced438aecf741e0e8021ec9b43c0b8724`，与迁移前一致。此项不是全部详情正文或后台发布流程验收。
- 本次没有修改生产开关、重新部署、调用 AI、执行统一数据回填或切换网站数据源。

本轮结构升级验收完成。旧来源和审计表继续保留，后续阶段不由结构升级结果自动授权。

## 2026-10-08：正式 apply 阻断及修复

用户明确不再重复预演，改为在当前维护冻结内直接执行受保护 apply。已完成新的双次 ACL 采集 [37649726399](https://github.com/hzense/tech-intelligence-hub/actions/runs/37649726399)，附件 `acl-evidence-37649726399-1` 重建一致，指纹为 `dfcd5663911d8ac9decac2e87cfcf51d1aab19ed7e47b7777ba7bf3f7f534598`；其相对 0030 前的变更仅来自新对象的所有者权限。

正式 apply [37768575644](https://github.com/hzense/tech-intelligence-hub/actions/runs/37768575644) 于 `11:17:48.325Z` 失败，日志明确 `migrationMayHaveCommitted=false`、`verificationCompleted=false`。随后 Neon 只读事务核查确认：`signals=0`、`signal_versions=0`、`ready=false`、`plan_hash IS NULL`；reader 新视图列读取与 writer 新输入列插入权限均未授予。这次失败不计作数据迁移完成。

根因为 apply 的 ACL 查询沿用 `search_path=public`，而采集入口固定为 `pg_catalog,pg_temp`。真实查询证明 `pg_get_function_identity_arguments` 对同一参数类型分别输出 `vector` 与 `public.vector` 等形式，导致仅 routines 类别产生误判。PR #213 将只读检查事务的路径和超时设置对齐，保留完整指纹相等比较，不忽略真实权限漂移。真实 PostgreSQL 18.4 的 3 项回归同时验证旧路径差异、修复后匹配、真实列授权变化阻断和异常后的会话恢复。

续跑须使用修复后的当前 main、成功 CI 和新 run-bound 审批。数据计划 `748b0141b69f9050ff268a20763f0bd5ec3882a2c6cce73ef73260561c77c27c` 仅作为严格 expected 值：正式事务锁定来源和目标、重新构建计划，匹配后才允许 INSERT。绑定当前 31 项 manifest，不复用旧审批，也不把历史计划当作当前数据核验。此记录尚未证明后续 apply、独立 verify 或网站切读成功。

PR #213 已合并为 `ae973cb13773acb0c377aa7cce9e076ace756703`，PR CI [37771579977](https://github.com/hzense/tech-intelligence-hub/actions/runs/37771579977) 与合并后 main CI [37772179781](https://github.com/hzense/tech-intelligence-hub/actions/runs/37772179781) 均通过。首轮 PR 审计因既有 Next.js 16.3.6 安全公告失败，最小补丁升级至 16.3.8 后重新全量通过，未关闭审计。

Vercel 生产部署 `dpl_CkfRHTkc79gPQDxRYG9zx6nJczgx` 为 READY，提交与上述 main 一致且正式别名包含 `hzense.com`。对同日迁移前快照的 112 条详情正文、链接、来源、状态及核心页面比较全部一致，聚合 SHA-256 均为 `f7d6a9b129d6492735529762272a2fcc4a75103205d9d0dea71adc5f2007fd9b`；健康接口 HTTP 200、`{"status":"ok"}`。本轮只证明修复代码部署后旧读路径保持正常，未证明统一切读。

修复后的正式运行 [37772790225](https://github.com/hzense/tech-intelligence-hub/actions/runs/37772790225) 绑定上述新 SHA、attempt 1、当前 31 项 manifest、已审核 ACL 与计划，新审批有效至 `2026-10-08T13:51:56.315Z`；经本次人工环境审批后成功执行，没有复用原失败运行的批准。

## 2026-10-08：正式回填与独立核验成功

| 阶段            | 运行                                                                                    | 原始结果时间（UTC） | 结果                                                                                |
| --------------- | --------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| 正式 apply      | [37772790225](https://github.com/hzense/tech-intelligence-hub/actions/runs/37772790225) | 11:59:43.695        | `committed=true`、`verificationCompleted=true`、`inserted=114`                      |
| 独立只读 verify | [37775017445](https://github.com/hzense/tech-intelligence-hub/actions/runs/37775017445) | 12:14:38.388        | `verificationCompleted=true`、`inserted=0`、`committed=false`（只读任务不提交数据） |

两次均绑定 `ae973cb13773acb0c377aa7cce9e076ace756703`，均为 `status=succeeded`、`previewOnly=false`、`cutoverReady=true`，确认 114 个身份、120 个版本、112 条公开信号、31 项迁移、62 张表及 0 项待迁移。数据计划含 110 条冻结归档和 10 个人工修订；2 个身份的最新状态为撤回，不重新公开。

两次核验的指纹完全一致：

| 对象          | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| 来源          | `53ddaed9e92c25f25344c53fffa7520bb0d757bb7e14de4c5ee4ab00be493c8f` |
| 计划          | `748b0141b69f9050ff268a20763f0bd5ec3882a2c6cce73ef73260561c77c27c` |
| 目标          | `5353aaaef11869e28fd1bb60060bec6d297274e6e2547403a40ff69543b0d1d6` |
| 公开 ID       | `9a3f54b787280ead62462d78a165460ced438aecf741e0e8021ec9b43c0b8724` |
| 31 项迁移清单 | `02f1f87abb7574817dc4d2a76fa29a870cfc01b2a952fb935ab51f1c447f8006` |

apply 在串行化事务内锁定源／目标、重新构建计划、逐版本与公开投影对账，并将最小授权与 `ready=true` 同事务提交；提交后另开只读连接核验，随后又通过单独工作流核验。不能再次重放 apply。旧归档与审计表保留，未调用 AI 或产生新的公开信号。

生效的增量授权仅为 writer 的 `editorial_signal_revisions(unified_content)` INSERT、reader 的 `unified_public_signals(signal_id,version,origin,publication_basis,content,recorded_at)` SELECT 与 `unified_public_status(ready)` SELECT；未给予业务角色 `signals`／`signal_versions` 直接写权限。

独立核验成功后，Production 设置 `HZENSE_UNIFIED_SIGNAL_ENABLED=1`（未改 Preview／Development），使用旧生产部署为输入、`withLatestCommit=false` 创建同 SHA 的新部署 `dpl_GXNWJbNDFHAsu2b61Ks2H5qyUxea`。新部署于 `12:18:05.084Z` READY，正式别名包括 `hzense.com`、`www.hzense.com`。健康接口 HTTP 200、`{"status":"ok"}`；代码证明该接口在统一开关开启时以只读角色检查 `ready` 及全部统一公开行。首页浏览器可见累计 112 条信号。

## 首次网页对比发现的兼容缺口

`12:19:14Z` 的全量采集确认 112 个详情页及 5 个核心页面均 HTTP 200，列表与 sitemap 的 Signal ID 集合一致；3273 段详情正文、112 个原文来源均保留。但详情链接总数由 875 变为 872，涉及 `editorial-41205e3e534acf1087c6572420569a99`：Tulsee Doshi、Google、Wiz 的已有目录链接消失，影响列表、资源目录和首页 TOP 5。比较结论为 **FAIL**，不以页面 200 或数据库核验成功代替公开页面一致性。

原因是统一 reader 给旧名称型人工修订附加 `public_resources: []`，而资源投影以该字段是否存在判断身份是否已审核登记，空列表让原本的唯一名称匹配被跳过。修复仅在尚无登记身份时不附加该字段，继续原有只读目录匹配；已登记身份仍优先，未知或歧义名称不生成身份，也不回写历史数据库正文。新增红绿回归覆盖旧／新读取投影一致、空目录、名称歧义及明确身份保护。同时将统一开关纳入旧发布 API 拒绝条件、旧雷达快照和 sitemap 的更新策略，避免切换后仍写旧发布链或使用旧评分。

本次不重放 apply、不再变更 Schema／ACL，不调用 AI 或试发布。兼容修复通过 CI、评审和重新部署后，须重新与原冻结基线比较；在全部通过前继续保持发布／撤回冻结。
