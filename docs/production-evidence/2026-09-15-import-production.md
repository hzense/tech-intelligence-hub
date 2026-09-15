# 2026-09-15 私有导入生产准备

## 范围与状态

操作者授权创建导入资源，并指定单批 10 美元、每日 50 美元、原件保留 7 天。导入基础代码 [PR #91](https://github.com/hzense/tech-intelligence-hub/pull/91) 已合并；main 提交 `045fcac85ac4465da9e12b469d3e8ae48e48dac6` 的 [CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34991346486) 成功，Production 部署 `dpl_HaVMg1XZDCct3sXwL6pQPogG7TWv` READY。资源配置后的重新部署尚未完成。

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

后续授权更新：操作者已明确回复“确认接受”，接受该新备份未验证恢复能力的风险，仅限 `0014` 迁移和导入角色最小授权。浏览器再次核对备份分支仍存在、父分支为 main、到期为 `2026-09-22T16:17:09Z`。此授权不是迁移或权限授予成功证明。

操作者进一步确认维护期间没有其他生产 DDL、角色授权或发布并行操作。PR #93 复审发现目标绑定缺口，已将数据库目标与备份哈希纳入 v2 计划，增加 ACL 采集前及实际迁移连接锁内检查；仍未执行生产 DDL。

1. 0014 固定迁移计划门禁的评审／合并、运行绑定审批、迁移及完整 Schema 核验；不能复用仅覆盖 0000–0013 的 AI 配置例外。独立恢复风险已接受。
2. 专用 `hzense_import_admin` 的最小 ACL、独立身份核验、Production DSN。
3. 保留策略 PR、CI、评审、合并及部署；真实 Store 空扫描后才开启云端清理。
4. 资源配置后的部署和受控合成文件端到端验收，最后开启导入。后台持续处理调度尚未配置。

原件满 7 天拒绝读取；物理删除由每小时任务执行，存在调度或故障延迟。私有解析结果与审计仍保留。没有上传真实用户文档，也未创建外部 OCR 资源。
