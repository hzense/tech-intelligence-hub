# Signals 页面与搜索索引同步验收（历史归档）

## 历史验收结论

本批页面抽样验收、正式搜索索引写入与独立零差异复核均已完成。正式写入新增 67 条搜索投影（66 个 Signal、1 个 Topic），保留 45 条，合计 112 条；最终只读复核确认 112 条全部 unchanged，新增 / 更新 / 删除均为 0。

112 是六类 `search_documents` 派生搜索文档的总数，不是 Signals 数量，也不表示向业务 `signals` 表执行了入库。本记录证明下述历史批次的验收结果，不代表当前生产数据量或全站验收状态。

执行观察区间：2026-09-11 22:33–23:10:08 UTC（柏林 2026-09-12 00:33–01:10:08）。最后一个运行的状态更新时间为 23:10:10 UTC。
本次运行绑定提交：`3ada816a0fc36cbb776f6004017619e31d193062`（[PR #61](https://github.com/hzense/tech-intelligence-hub/pull/61) 合并后的历史 main）。
归档复核日期：2026-09-12。

## 归档时只读复核

归档时重新读取了以下 GitHub Actions 运行状态、关键日志及 ACL 附件元数据。六个运行均绑定上述提交，且 `run_attempt: 1`。

| 阶段             | 运行                                                                                    | 最终结果                                                         |
| ---------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 前置 main CI     | [34653867428](https://github.com/hzense/tech-intelligence-hub/actions/runs/34653867428) | 成功                                                             |
| 初次搜索预演     | [34654487940](https://github.com/hzense/tech-intelligence-hub/actions/runs/34654487940) | 成功；新增 67、保留 45、更新 / 删除 0；`committed: false`        |
| 首次 ACL 门禁    | [34655087096](https://github.com/hzense/tech-intelligence-hub/actions/runs/34655087096) | 失败；`approval-run-mismatch`，在数据库采集前被阻断              |
| 新运行 ACL 采集  | [34655606439](https://github.com/hzense/tech-intelligence-hub/actions/runs/34655606439) | 成功；已生成 ACL 附件                                            |
| 搜索正式写入     | [34656272558](https://github.com/hzense/tech-intelligence-hub/actions/runs/34656272558) | 成功；新增 67、保留 45、更新 / 删除 0；`committed: true`         |
| 最终独立搜索预演 | [34656517773](https://github.com/hzense/tech-intelligence-hub/actions/runs/34656517773) | 成功；112 条 unchanged，新增 / 更新 / 删除 0；`committed: false` |

- 重新核对的预演、正式写入及最终预演计数与下文一致；投影 / 计划指纹及正式写入风险接受摘要与记录相符，正式写入日志仍明确 `recoveryVerified: false`。
- 附件 `acl-evidence-34655606439-1` 在归档复核时未过期，元数据所列到期时间为 `2026-10-11T22:53:58Z`。本次仅核对附件元数据，没有重新下载或重算 ACL 附件正文；本文件的 Git 归档不等于永久保存 Actions 附件。
- 下文的浏览器页面、Neon 备份存在性以及 ACL 附件完整性复核，保留的是执行当时的观察；本次归档没有重新执行这些检查，也没有连接生产数据库、修改 Secrets 或触发维护任务。
- 仅归档运行链接、计数与脱敏指纹，不保存连接串、密码、原始审批 JSON 或备份引用原值。备份存在及 ACL 采集成功均不证明恢复能力已验证。

## 历史过程记录

以下按执行阶段保留当时记录。“当前”“尚未”“待审批”“下一步”等措辞仅描述对应阶段的历史状态，不是新的待办或执行授权；最终结果以上述归档结论及文末独立复核为准。

### 已确认

- 合并后 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34653867428) 成功；生产维护前回读远程 main 仍为上述提交。
- 通过连接的 Chrome 浏览器读取真实 [Signals 页面](https://hzense.com/signals)，列表包含 82 条链接，新增批次已展示，顺序使用事件 / 公告日期而非采集日期。
- [Waymo 详情](https://hzense.com/signals/signal-20260825-waymo-munich-testing)显示 2026 年 8 月 25 日、来源链接、评分及“自主系统”专题链接。
- [自主系统专题](https://hzense.com/topics/topic-autonomous-systems)正常展示标题及介绍，未出现 404。
- 同步前 [Waymo 搜索](https://hzense.com/search?q=Waymo)显示 0 条结果。这是新增页面已上线但搜索未命中的观察，不是数据库全量计数或同步完成证明。

### 搜索同步进度

- 已发起 [Production maintenance / search-dry-run #34654487940](https://github.com/hzense/tech-intelligence-hub/actions/runs/34654487940)，绑定上述 main 提交。
- 初次回读为 `waiting`。操作者审批后，再次回读确认运行已于 2026-09-11 22:35:31 UTC 成功完成，maintenance 的执行步骤成功。
- 此操作仅计算同步计划、回滚事务，不提交数据库变更。不复用旧运行的审批。
- 脱敏输出：`desiredCount: 112`、`inserted: 67`、`updated: 0`、`deleted: 0`、`unchanged: 45`、`committed: false`。新增数量与 66 条 Signal 加 1 个 Topic 的仓库变更一致；没有更新或删除计划。
- 投影指纹：`a052a9f27c52d3fb212d7ccfffdf260d1fc9304cc24d5499e8344aea65f9ec5a`。
- 计划指纹：`aa1b76f5be26ae0ed0c9e70f748d9dad8cbfdb6f0f2ed1f14ac709a1bc9e5c0c`。
- 尚未发起 `search-apply`，未声称生产搜索已同步。只读预演的 Environment 审批不代替正式写入的运行绑定审批、备份与当前维护窗口核对。
- 后续：确认本次发布 / DDL 冻结窗口并核对当前备份及 ACL 依据 → 配置绑定新 run 的写入审批及上述双指纹 → 单独审批正式 Apply → 独立 no-op 复核与线上查询验收。不复用旧 run 的审批记录，不伪造恢复成功。

本轮没有迁移、恢复演练、ACL normalization、备份分支延长或搜索模式切换。页面验收使用浏览器替代当前环境不可用的 agent-browser CLI。

### 维护窗口与备份复核

- 操作者回复“可以”，确认本次同步期间没有其他生产发布或数据库变更，可以进入维护窗口。
- 2026-09-11 22:39 UTC 在 Neon Console 只读复核：现有备份分支仍存在，父分支为生产 main，保留设置为 Never；本次没有创建、重置或延长分支。不公开原始备份 ID，不把存在性复核视为恢复能力验证。
- 同时回读远程 main 仍为上述运行绑定提交，最新 main CI 成功，最近维护任务均已结束；Environment 仍要求人工审批且不允许管理员绕过。
- 上一维护窗口的 ACL 采集 #34641070531 成功，但不将其自动视为本次窗口的新采集。
- 本次尝试发起新的 `acl-capture` 被工具安全审核拒绝，命令未执行、没有产生新运行；阻塞原因为需明确授权将生产 ACL 权限元数据作为附件保存到 GitHub 目的地。没有绕过该拦截或替换为本地生产采集。
- 下一步需取得操作者对本次生产 ACL 双采集及当前仓库 Actions 附件存储的明确授权，再准备运行绑定审批。正式搜索写入尚未发起。

### 本次 ACL 运行准备

- 操作者已明确确认授权本次生产 ACL 元数据采集并保存到当前 GitHub 仓库的 Actions 附件（可能公开，保留 30 天，不含凭据或业务行）。
- 已创建 [acl-capture #34655087096](https://github.com/hzense/tech-intelligence-hub/actions/runs/34655087096)，绑定 `3ada816a0fc36cbb776f6004017619e31d193062`；回读为 `waiting`，没有已执行的 maintenance 步骤。
- 准备更新 `production-maintenance` 环境中的 `MAINTENANCE_APPROVAL` 和 `MAINTENANCE_BACKUP_ID` 时，工具安全审核要求对这两项持久配置修改单独授权。命令被拒绝，两个 Secret 未由本次操作修改，未提交环境审批。
- 在运行绑定审批配置完成前，不应批准此任务，以免旧配置触发 `approval-run-mismatch`。后续配置须保留恢复能力未验证声明，不修改数据库连接凭据，不绕过人工审批。

### 运行绑定审批已配置

- 操作者明确授权仅为本次采集更新两个维护 Secrets，保留维护冻结、公开归档及恢复未验证风险声明。
- 回读发现 #34655087096 已于 22:43 UTC 执行并被 `approval-run-mismatch` 阻断；根据入口校验顺序，该失败发生在调用数据库采集前，未产出 ACL 附件。
- 已新建同范围的只读 [acl-capture #34655606439](https://github.com/hzense/tech-intelligence-hub/actions/runs/34655606439)，提交仍为 `3ada816a0fc36cbb776f6004017619e31d193062`，attempt 1。
- 已成功更新受保护环境内的 `MAINTENANCE_BACKUP_ID` 和 `MAINTENANCE_APPROVAL`，仅绑定新运行与 `acl-capture`；审批记录到期时间为 `2026-09-12T00:49:31.055Z`。原始值没有写入仓库。
- 配置沿用刚核验的不自动过期备份，保留 `recoveryVerified: false`；没有修改数据库密码、自动批准 Environment、执行恢复或正式搜索写入。需要操作者在新运行页面批准后，再读取真实采集结果。

### ACL 采集成功并复核

- 操作者批准后，#34655606439 已于 2026-09-11 22:54:01 UTC 成功完成，包括附件归档步骤。
- 附件 `acl-evidence-34655606439-1` 已生成且未过期。仅下载已授权的附件用于只读完整性复核，未从本地连接生产数据库。
- 校验了仓库、提交、run/attempt、两份独立采集数量及风险声明摘要；使用现有 `reviewedBaseline` 重建两份基线，11 类目录、总指纹和备份引用一致。
- 本次 ACL 指纹：`c58f27e7a49e83e46ffc6478c999658e444baf90aebf03fd86d435fe119ca461`。
- 本次采集审批摘要：`f9fe7fcedcdc91b21dc1bcdd82cd90f4558d6462e8eb1f76ba9b838664830807`。恢复能力仍为未验证，采集成功不证明恢复可用。
- 下一步为 `search-apply`，需新的运行绑定审批，引用同 SHA 的投影 / 计划指纹及本次 ACL 指纹。当前两个 Secrets 的授权和记录仅用于 ACL 采集，不直接复用于正式写入；尚未发起写入运行。

### 正式写入任务待审批

- 操作者已明确批准创建 `search-apply` 并更新相应的 `MAINTENANCE_APPROVAL`，范围为已预演的 67 条新增、45 条保留、0 更新、0 删除。
- 再次确认 main 为上述提交、该 main 的最新 push CI 成功，无并发维护任务，Environment 人工审批与禁止管理员绕过仍有效。
- 已创建 [search-apply #34656272558](https://github.com/hzense/tech-intelligence-hub/actions/runs/34656272558)，attempt 1；仅更新了绑定该运行的 `MAINTENANCE_APPROVAL`，包含本记录的投影、计划和 ACL 指纹。
- 审批记录通过既有纯函数合约校验；有效期截至 `2026-09-12T00:59:50.794Z`，审批摘要为 `cf15eee90ce1f81a8818513cb03c7f4d4928108aad34038fc8e50de306289b5b`。未输出或保存原始审批内容。
- 没有更改备份 Secret 或数据库凭据，没有代替操作者提交 Environment 批准。配置完成不表示数据已提交；等待人工批准后，必须核实 `committed: true`、实际计数及后续独立 no-op 复核和网站搜索结果。

### 正式写入成功与线上查询验收

- 操作者批准后，#34656272558 成功完成；执行摘要时间为 2026-09-11 23:01:18 UTC，`committed: true`。
- 实际结果：`desiredCount: 112`、`inserted: 67`、`updated: 0`、`deleted: 0`、`unchanged: 45`。投影与计划指纹均等于已审核 dry-run，风险接受摘要与本次审批记录相符；`recoveryVerified` 仍为 false。
- 浏览器实测 [Waymo 全类型搜索](https://hzense.com/search?q=Waymo)由同步前 0 条变为 1 条，结果链接指向新增 Signal，日期为 2026 年 8 月 25 日。
- [Waymo 信号筛选](https://hzense.com/search?q=Waymo&type=signal)同样返回 1 条；[自主系统专题搜索](https://hzense.com/search?q=%E8%87%AA%E4%B8%BB%E7%B3%BB%E7%BB%9F&type=topic)返回 2 条，含新增自主系统专题及原有人形机器人专题。
- 公共 `/api/health/database` 返回 HTTP 200，正文为 `{"status":"ok"}`。
- 已发起独立只读 [search-dry-run #34656517773](https://github.com/hzense/tech-intelligence-hub/actions/runs/34656517773)，同一提交，当前 waiting。该步骤用于确认全部 112 条 unchanged、增改删均为 0；尚未取得最终 no-op 结果，不把待审批视为复核完成。
- 搜索写入与线上抽查已成功，最终独立一致性复核仍待人工批准。此运行不注入写操作审批与备份 Secrets，不再次提交数据变更。

### 最终独立零差异复核通过

- 操作者审批后，[search-dry-run #34656517773](https://github.com/hzense/tech-intelligence-hub/actions/runs/34656517773) 已成功完成，日志时间为 2026-09-11 23:10:08 UTC。
- 执行提交：`3ada816a0fc36cbb776f6004017619e31d193062`，与本批正式写入及预演一致。
- 实际结果：`desiredCount: 112`、`inserted: 0`、`updated: 0`、`deleted: 0`、`unchanged: 112`、`committed: false`。这是新运行的独立只读结果，不是复用正式写入摘要。
- 投影指纹保持 `a052a9f27c52d3fb212d7ccfffdf260d1fc9304cc24d5499e8344aea65f9ec5a`；零差异计划指纹为 `b1dae494bdb2172bb613033fd479b58a75aaa7ab84f396bb2c9c6ea367e5bd59`。计划指纹随待写入集合归零而变化，投影指纹不变。
- 结合上述 82 条 Signals 列表观察、页面抽样、67 条索引正式写入、线上查询及健康检查，本批“页面抽样验收 + 搜索索引同步”执行闭环完成。这里的 112 是六类搜索文档总量，不是 Signals 数量，也不表示向业务 `signals` 表执行了全量入库。
- 恢复能力仍未验证；未执行迁移、ACL normalization、恢复演练或搜索模式切换。本记录按历史批次归档，不将此次文档整理记为新的生产执行。
