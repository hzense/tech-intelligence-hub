# 2026-09-15 私有导入生产准备

## 范围与状态

操作者授权创建导入资源，并指定单批 10 美元、每日 50 美元、原件保留 7 天。导入基础代码 [PR #91](https://github.com/hzense/tech-intelligence-hub/pull/91)、保留策略 [PR #92](https://github.com/hzense/tech-intelligence-hub/pull/92)、独立迁移门禁 [PR #93](https://github.com/hzense/tech-intelligence-hub/pull/93) 已合并。2026-09-15 已核验 main `630610fa93faf400442eaa8991ac32d3ddb8d902` 的 [CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34998673977) 成功，Production 部署 `dpl_FpvNsqkXriA47cizBkYFyk3VMESA` READY；这不代表导入已启用。

**导入开关和定时清理均保持关闭。** 本记录不是导入上线或恢复演练完成证明；没有调用 AI、OCR，没有写公开 Signal、发布或搜索投影。

## 已完成的资源与只读核验

- Vercel 专用私有 Blob Store `hzense-import-originals`，地区 `iad1`，仅关联 Production。专用令牌已保存至 Vercel Production 和当前仓库的加密 Secret，未记录令牌值。
- Production 保存了单批 `10000000`、每日 `50000000`、单次预留 `100000` microUSD；保留天数为 7，Store ID 固定核对，`HZENSE_IMPORT_ENABLED=0`。应用预留不是 Vercel 账单或平台硬支出上限，存储和网络另计。
- 干净解析镜像 `snap_gVYmKWCJ1bUAuziDgRykqW0aiVjx` 已创建。独立断网冷启动验证 Python 3.11+ 与 pypdf 6.18.1 成功，验证实例已停止。镜像不包含用户文档或注入的应用密钥；镜像不设到期时间，与原件 7 天政策分开。
- Neon 备份分支 `pre-import-0014-20260915`（`br-summer-rice-av63302k`）从 main 的当前数据与 Schema 创建。创建时间 `2026-09-15T16:17:09Z`，到期 `2026-09-22T16:17:09Z`。只确认存在，未验证恢复能力。
- 受保护只读预检 [34993635520](https://github.com/hzense/tech-intelligence-hub/actions/runs/34993635520) 经操作者审批后，于 `2026-09-15T16:18:27Z` 成功完成。脱敏结果 `pendingMigrationCount=1`；对应待执行 `0014_import_tasks.sql`。预检未迁移或授权。
- GitHub 已保存清理专用 Secret 和 Store ID；`HZENSE_IMPORT_RETENTION_ENABLED=0`，没有执行真实删除。
- Production 解析镜像 ID 与随机 Worker 服务令牌已保存。平台 API 确认所有新配置为 Production-only Sensitive 类型；CLI 回读为空是保密行为，不能据此推断变量为空，也没有降低敏感等级。真实 Store 空扫描使用同一专用 Store 的原始集成令牌，结果为 `scanned=0, eligible=0, deleted=0`；尚未验证部署运行时读取全部 Sensitive 配置。

## 本地与隔离回归

本轮 Web 默认测试 390 项通过、6 项环境测试跳过；单独开启导入实际组件浏览器测试，桌面／移动端 1 项通过。原生 PostgreSQL 导入存储及角色隔离 18 项通过；导入包 41 项通过，包含真实合成 PDF 解析。Web 生产构建、类型检查，Web／数据库／导入包 lint 与工作流验证通过。这些不代替云端全链路验收。

## 仍未完成

### 2026-09-16 迁移已提交，完整核验待修复

- [预检 34999035044](https://github.com/hzense/tech-intelligence-hub/actions/runs/34999035044) 成功，只有 0014 待迁移，目标和备份绑定与批准计划一致。
- [ACL 采集 35069259800](https://github.com/hzense/tech-intelligence-hub/actions/runs/35069259800) 成功，两次独立指纹相同：`2165a195f946fda0f0e1fc85e5abe4b6b42ed4d20edeae8f98e0188fb97bda5a`；脱敏制品 `acl-evidence-35069259800-1` 已归档。恢复能力仍为 `recoveryVerified=false`。
- [迁移 35070299513](https://github.com/hzense/tech-intelligence-hub/actions/runs/35070299513) 工作流结果为失败，公开错误仅为 `database-or-contract-check-failed`。随后 Neon main/hzense 的只读账本查询确认：**0014 已于 `2026-09-16T07:49:59.714336Z` 提交**；迁移记录 15 条，7 张导入表存在，0014 checksum 为 `ae84c8eb9c212c48bde256eda199238f8d43579f2caa969b76fcc248709eda8a`。
- 明确发现迁移后校验冲突：既有 `configure_signal_admin_reader.sql` 允许只读角色执行 `hzense_public_signal_is_current(uuid)`，实际 ACL 也有该非转授权 EXECUTE，但 `current-publication-catalog.mjs` 未列入该角色。修复仅同步这一函数的可接受授权名单，不修改函数、迁移 SQL 或生产 ACL。
- 新增目录级正负回归，以及实际执行正式角色授权脚本后的完整 `verifyDatabaseContract` 回归。撤回此名单修复时两项测试均复现同一函数契约错误；恢复修复后通过。必须在合并后单独执行生产 **`verify`**，不能重跑 `migrate`；尚不声称完整生产核验或导入上线完成。
- PR #94 评审进一步要求不能仅信任角色名。完整核验在发现该可选直接授权时，于只读事务中复用正式授权脚本的独立 post-GRANT 断言块（不执行授权段或 COMMIT），检查角色属性、双向成员关系、所有权、跨库边界和完整有效／直接 ACL。原生回归覆盖角色属性、双向成员、额外原文列与缺失必要列的漂移，均拒绝；无该授权时仍允许尚未配置 reader。

后续授权更新：操作者已明确回复“确认接受”，接受该新备份未验证恢复能力的风险，仅限 `0014` 迁移和导入角色最小授权。浏览器再次核对备份分支仍存在、父分支为 main、到期为 `2026-09-22T16:17:09Z`。此授权不是迁移或权限授予成功证明。

操作者进一步确认维护期间没有其他生产 DDL、角色授权或发布并行操作。PR #93 复审发现目标绑定缺口，已将数据库目标与备份哈希纳入 v2 计划，增加 ACL 采集前及实际迁移连接锁内检查；当时尚未执行生产 DDL，后续执行结果见上文。

1. 合并只读角色校验契约修复，单独运行生产 `verify` 完成完整 Schema 核验；0014 已提交，不重复执行迁移。
2. 专用 `hzense_import_admin` 的最小 ACL、独立身份核验、Production DSN。
3. 保留策略代码已合并部署，真实 Store 空扫描后才开启云端清理。
4. 资源配置后的部署和受控合成文件端到端验收，最后开启导入。后台持续处理调度尚未配置。

原件满 7 天拒绝读取；物理删除由每小时任务执行，存在调度或故障延迟。私有解析结果与审计仍保留。没有上传真实用户文档，也未创建外部 OCR 资源。
