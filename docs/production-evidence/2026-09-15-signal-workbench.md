# Signal 只读工作台生产配置记录（2026-09-15）

## 当前结论

阶段 1 只读工作台代码已合并，生产完整 Schema 只读核验成功，确认 14 个迁移、40 张表。新 reader 凭据创建、最小只读授权事务及授权后独立核对已完成，专用数据库 Secret 已成功保存为 Production-only。同 SHA 新部署已 READY 并绑定 `hzense.com`；真实 Google 管理员页面和同源 GET API 已成功读取生产数据库的空结果。

只读连接及空数据路径已完成生产验收；生产暂无 Signal 版本，真实非空详情、历史版本与关联证据仍不能算已在线验收。六阶段后续导入、生成和发布并未因此完成。

配置前真实 Google 管理员会话已进入 `/admin/signals`，当时页面提示尚未配置，没有 Seed 回退。该历史观察不作为本次配置后的读取验收。本记录不包含密码、数据库主机、连接串、完整生产项目或分支 ID。

## 已交付代码与配置前部署

- [PR #88](https://github.com/hzense/tech-intelligence-hub/pull/88) 已 squash 合并为 `55f0bfd60bb83184dd61599ce5afa07ef9819296`。
- [PR CI #34954000779](https://github.com/hzense/tech-intelligence-hub/actions/runs/34954000779) 与 [main CI #34954309417](https://github.com/hzense/tech-intelligence-hub/actions/runs/34954309417) 均成功。
- 配置前 Production 部署 `dpl_6PakN2m3qGrhWiKzxaHWVofRa8RS` 为 READY，绑定 `hzense.com`，提交与上述 main SHA 一致。
- Chrome 中真实 Google 管理员会话可进入 `/admin/signals`，显示尚未配置状态，没有回退至 Seed 数据。该结果只证明当前页面及配置缺失提示可达，不是受限数据库连接验收。

## 本次授权范围

操作者已同意：创建独立 `hzense_signal_admin_reader`，连接数限制为 2，授予工作台所需的最小列级只读权限；在本项目 Vercel 保存仅 Production 可用的 `HZENSE_SIGNAL_ADMIN_DATABASE_URL`，并重新部署、验收。

该授权不包含导入数据、发布或撤回 Signal、调用 AI、启用采集任务、切换网站公开数据源。本轮不修改已有角色密码或扩大 Runtime、AI Admin、Publisher 的权限。只读角色授权以已审核的 [configure_signal_admin_reader.sql](../../db/roles/configure_signal_admin_reader.sql) 及其授权前后守卫为准，不用角色名称或连接数单独代替最小权限核验。

## 受保护的完整 Schema 核验

[Production maintenance verify #34956259661](https://github.com/hzense/tech-intelligence-hub/actions/runs/34956259661) 经操作者 Environment 审批后成功。`2026-09-15T10:10:14Z` 的脱敏最终输出为：

```json
{
  "operation": "verify",
  "status": "succeeded",
  "migrationCount": 14,
  "tableCount": 40
}
```

本次选择的是只读 `verify`，执行生产预检及现有完整 Schema 合约校验，没有运行迁移、修改 ACL 或启用业务开关。此结果不能代替随后新建 reader 的角色属性、精确列权限及实际连接验收。

## Neon 现场只读检查

以下结果来自配置前的 SELECT 检查；角色不存在的结论限定于检查时点，后续创建及授权结果另见下文。

| 检查位置              | 已观察结果                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| 生产 `main`／`hzense` | 实际账户为数据库 owner `hzense_migrator`；迁移账本 14 条 checksum 与仓库一致，共 40 张表。         |
| Signal 数据           | `signal_versions` 为 0 行，`current_public_signals` 为 0 行；这不是全站所有现有内容为空的结论。    |
| 新只读角色            | `hzense_signal_admin_reader` 不存在。                                                              |
| 生产 `main`／`neondb` | 实际账户为数据库 owner `neondb_owner`，拥有 `CREATEROLE`，不是超级用户；再次确认新只读角色不存在。 |

上述只读检查与新建凭据、授权事务分别记录；SQL 已填入编辑器不代表已执行或提交。

## 新凭据创建后的独立核对

操作者确认已点击 Run 后，查询结果包含最终 COMMIT 成功和一行新密码结果。秘密仅在配置会话内存中用于已批准的 Vercel Production Secret，不进入本记录、聊天输出或仓库。

另起单条只读 SELECT，真实会话仍为 `neondb`／`neondb_owner`，确认：

- `hzense_signal_admin_reader` 已存在，`LOGIN=true`、`INHERIT=false`、连接上限 2。
- SUPERUSER、CREATEDB、CREATEROLE、REPLICATION、BYPASSRLS 全部 false。
- 唯一成员关系为 `cloud_admin` 向 `neondb_owner` 授予 Reader 的管理边；ADMIN=true，INHERIT=false，SET=false。没有向 Reader 反向授予 owner 能力。
- 角色设置为 0，直接 ACL／所有权依赖为 0；此时尚无工作台数据授权。

授权脚本来自 PR #88 合并提交，独立复核确认与运行时契约一致：15 个关系、76 个 SELECT 列及一个只读资格函数。Neon 对超长查询提示历史文本会截断，因此完整脚本以仓库已审核版本为准，不能从截断的查询历史重放。

## 最小授权与 Production Secret 保存

操作者明确确认执行最小只读授权后，授权事务已成功 COMMIT。随后独立 SELECT 核对结果如下；这些计数是授权后的脱敏摘要，精确列集合仍由已审核脚本及其提交前守卫约束。

| 检查               | 已观察结果                                                                        |
| ------------------ | --------------------------------------------------------------------------------- |
| 列级只读权限       | 15 个关系，共 76 个 SELECT 列；其他列权限和列级 grant option 均为 0。             |
| 直接 ACL 数        | database／schema／relation／column／function 分别为 `1／1／0／76／1`。            |
| 写权限与 AI 私表   | 应用业务写权限为 false；5 张 AI 表的读取权限均为 false。                          |
| 角色属性与管理关系 | 所有权、角色设置均为 0；原有精确 Neon ADMIN-only 管理边未改变。                   |
| 跨数据库边界       | `neondb` 无权限；`postgres`／`template1` 仅保留既定 provider 例外，没有扩大权限。 |

Vercel 已确认 `HZENSE_SIGNAL_ADMIN_DATABASE_URL` 保存成功，类型为 Secret，范围仅 Production。没有修改既有 Runtime、AI Admin 或 Publisher 的凭据及权限，也没有将变量值、主机或密码写入本记录。

配置后的 Production 重新部署 `dpl_3daZkTjEFj9ohwydbmz4DGipbEBP` 于 `2026-09-15T12:22:30.068Z` READY，提交仍为 `55f0bfd60bb83184dd61599ce5afa07ef9819296`，`hzense.com` 及 `www.hzense.com` alias 已绑定。平台 `buildingAt` 至 `ready` 约 72.1 秒，框架为 Next.js。本次仅重新部署已审核代码以加载新 Secret，没有修改功能代码或业务开关。

## 配置后真实读取与访问边界

真实管理员经已有 Google 登录流程进入 `/admin/signals`，无筛选及游标。页面显示读取时间 `2026-09-15 12:23:38 UTC` 和“数据库中暂无信号快照／已成功读取”，配置缺失提示消失。页面继续明确标注公开站仍使用旧版数据源，没有 Seed 回退。

同一真实浏览器会话发起同源只读 GET，未导出 Cookie 或构造生产会话：

| 检查                            | 已观察结果                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 管理员 `GET /api/admin/signals` | 200；`items=[]`、`next_after=null`、`observed_at=2026-09-15T12:24:16.721Z`。                                                  |
| 管理员请求不存在的 Signal 详情  | 404，固定 `not_found`，没有创建测试数据。                                                                                     |
| 管理员请求 `limit=0`            | 400，固定 `invalid_query`。                                                                                                   |
| 匿名列表和详情 API              | 均为 401，固定 `unauthorized`。                                                                                               |
| 匿名 `/admin/signals`           | 307 到 `/admin/login`。                                                                                                       |
| 私有响应边界                    | 上述 API 均为 `Cache-Control: private, no-store`；列表及匿名 API 确认 `X-Robots-Tag: noindex, nofollow`，页面也私有且不缓存。 |
| 既有数据库健康接口              | 200，`{"status":"ok"}`。它不是专用 reader 验收的替代证据。                                                                    |

ready 空结果意味着专用 reader 已通过真实身份及有效 ACL 检查，并在只读事务内完成列表读取；不是仅凭页面 HTTP 200 推断连通。本次没有重新进行生产跨站请求矩阵、非空数据或并发压力测试；相关隔离测试见 [工作台记录](../SIGNAL_WORKBENCH.md)。

## 部署后短窗口日志与验收限制

新部署日志检查窗口为 `2026-09-15T12:22:30.068Z` 至 `12:24:40Z`，已超过 READY 后 60 秒。未找到 5xx；error/fatal 级别检索返回两条 Google 登录流程的 Node.js `DEP0169 url.parse()` 弃用警告，对应 HTTP 200／302，真实登录成功。不能将此记录称为“零错误日志”或一小时稳定性验收。弃用警告保留为依赖维护事项，本轮没有修改认证实现。

本轮使用 Vercel 运行日志即时核对，没有新建 Drains 或外部监控，未核对全量告警覆盖；短窗口结果不代表长期容量或可用性保证。

凭据创建、只读授权、独立权限摘要核对、Production Secret 保存、配置后部署及真实只读空态验收均已完成。不得重复创建、授权或重置密码。当前生产没有 Signal 版本数据，真实非空详情、历史版本及关联证据展示留待经过授权的真实数据接入后验收；不为本次验收写入合成业务数据。导入、AI 调用、发布及网站数据源切换保持在本轮范围之外。
