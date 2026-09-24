# 通用材料人工确认与独立核验：生产准备记录

记录日期：2026-09-24。只记录可区分的代码、测试及生产证据，不包含凭据、原文、真实连接串或私钥。

## 已知状态

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

## 生产启用前必须重新完成

1. 完成本批 PR 评审、CI、合并及精确生产部署核对。
2. 对新 main 重新只读 preflight。若生产仍只到 0022，预期待执行 `[0023,0024]`；若已独立执行 0023，则只允许 `[0024]`。任何其他序列保持阻断。
3. 绑定本批新备份、维护冻结声明、实际 pending 与目标指纹；另行批准 `accept-unverified-material-review`／`material-review-production-launch` 风险范围。旧 0022／0023 批次批准不可复用，恢复能力未演练的边界仍保留。
4. 获批后执行迁移及独立 verify；再分别批准受限角色配置、0023 基础权限和 `configure_material_review.sql` 的两表增量 ACL，不扩大 Runtime／Publisher 等既有角色权限。
5. 配置独立 GitHub 受保护环境、公钥和最小 token：签名私钥仅在 GitHub `material-verification` Environment；网站只有公钥和第一方 Worker／派发凭据。所有真实值不入仓库，新凭据与授权另行确认。
6. 默认关闭的 `HZENSE_MATERIAL_REVIEW_ENABLED` 与 `HZENSE_MATERIAL_EXECUTOR_ENABLED` 经配置核验后才开启，同时确认 registration 写入开关。用一条已批准的合成材料完成提案、人工确认、独立执行、报告保存及登记回执闭环；不自动发布。

0023–0024 SQL、角色脚本、真实生产权限和页面验收是不同证据。当前记录只达到准备阶段，待执行项不得提前勾选完成。
