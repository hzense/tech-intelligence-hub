# 候选补全生产启用记录（2026-09-23）

## 已核实

- PR #152 已合并，提交 `f530f7050b53297e3b3b304183986efedd720d1f`；PR CI `35873676877` 与 main CI `35874218436` 全部通过。
- Vercel Production `dpl_2toFG4XGxMTmp2D7sPxmXA7HCSe5` READY，`hzense.com` 已绑定此版本；健康检查 HTTP 200、`{"status":"ok"}`、`Cache-Control: no-store`。
- 已登录生产候选页，确认新增“启动 AI 自动补全”入口、原有候选和目录检查正常读取。未点击启动、未调用 AI。
- 隔离 PostgreSQL 验证 23 项迁移、52 张表；真实受限 generation 角色的补全 ACL/任务生命周期测试通过。

## 维护边界

用户要求启用补全器，范围为新增 `0022_candidate_enrichment_runs.sql` 和 `upgrade_candidate_enrichment.sql` 精确列授权，不改密码、不调用付费模型、不发布信号。

旧 `accept-unverified-candidate-review` 策略仅允许 `0020–0021`，不得复用。新的 `accept-unverified-candidate-enrichment` 策略固定完整 23 项迁移文件及 checksum，实际待迁移只能是单个 `0022`；目标、备份标识、main 提交、run/attempt、有效期与冻结执行产物均重新核对。仅明确接受“恢复尚未演练”风险时使用该策略，不能把风险接受写成恢复能力已验证。

## 待完成

- [ ] 只读生产预检（初始 run `35875001784` 等待环境审批）。
- [ ] 新备份存在性与有效期核对、维护窗口无并行 DDL/ACL/发布确认。
- [ ] 绑定本次备份的 ACL 基线采集与迁移审批。
- [ ] 受保护 `0022` 迁移、完整 Schema 核验。
- [ ] owner 执行最小 ACL 升级、运行角色矩阵独立核验。
- [ ] 无 AI 的线上可用性检查；真实付费执行须单独确认。

生产读取日志有一条 `pg` 同 client 并行查询弃用警告，对应审核读取请求 HTTP 200；不是补全成功证据，也未阻断该次读取。
