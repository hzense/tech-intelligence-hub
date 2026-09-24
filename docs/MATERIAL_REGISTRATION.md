# 通用候选补证与正式材料登记

2026-09-24：开发版，默认关闭，尚未部署生产。独立材料核验服务尚未接入；本批不是“所有候选已自动补全”。

## 管理员怎样使用

入口在每条 AI 候选的审核确认页，名称为“通用补证与登记”。

1. 在“导入已解析资料”导入补充的官方公开链接并完成解析。
2. 回到候选页，关联至多三份自己的链接资料，确认建立补证请求。
3. 等待独立核验方返回签名报告；此时不能登记或发布，建立请求也不会调用 AI。
4. 核对报告中的人物、组织、领域、证据原句与来源，点击“确认登记材料（不发布）”。
5. 系统重新读取正式发布材料；齐备后继续原有候选核验、转换及正式发布流程。

不要求管理员填写 ID、JSON、人物名称或主张。人物无原文依据、来源使用许可未确认、目录同名冲突、领域停用等情况保持阻断，不为消除待补全状态虚构或覆盖记录。

## 实现范围与限制

- 原生成快照、候选和账本不变。`baseMaterialHash` 绑定原候选，`sourceBundleHash` 绑定补证包，`planHash` 绑定登记计划。
- 原文与补充资料合计最多 48 KiB；至多三份当前用户已完成、未取消/删除的 URL 输出。允许一份与原私有正文相同的公开 URL 补出处；重复补充 item 或两份同正文补充资料拒绝。文件上传本身不构成公开证据。
- 原件本身来自公开 URL 时，服务器重新按 owner 读取原导入来源，并校验解析内容 hash 与原生成快照一致，才允许直接使用原来源；不接受浏览器传 URL。原导入删除或变化后，不能继续使用其 URL 绑定，需要独立补证。
- 页面显示最近十个请求、每个最近三份报告；权威材料选择和按编号续行使用独立查询，不因显示截断遗失已登记报告。
- 登记分两个可续行事务：registrar 新建中性来源、实体、档案及 **pending** 证据；verifier 复查签名计划覆盖的数据后才将 pending 改为 verified。rejected 不复活，已有记录不覆盖。
- 数据库 ALWAYS 触发器约束两角色分别只能写 `registered`、`verified` 回执。回执是历史核验记录，不是永久有效或公开发布许可；后续禁用来源、领域或撤销证据仍会阻挡发布。
- 未知提交保留原编号；创建、读取、登记均不调用模型。数据库唯一约束与指纹阻止刷新后重复创建相同材料。

## 独立核验接入

`/api/internal/material-verification` 是服务接口，不是公开表单。使用专用 Bearer token，严格限制请求字段和大小，错误不输出原文、凭证或内部数据库信息。

- GET：返回 `{requests,nextCursor}`，每页至多十个待处理请求；用 `?after=<nextCursor>` 继续读取，避免证据不足的旧请求阻塞后续任务。
- POST `action=read`，`request={owner,requestId}`：读取不可变原文包、原候选和有界正式目录；目录超过上限时拒绝，不把截断目录当作完整目录。
- POST `action=report`，`request={owner,requestId,plan,attestation}`：提交登记计划及 Ed25519 签名。

协议权威为 `packages/database/src/material-registration-contract.mjs` 及 `.d.mts`。签名格式 `{keyId,payload,signature}`，独立协议 `signed-material-verification-v1`；绑定 owner、任务/候选、三个摘要和核验方身份，并提供来源真实性、使用许可、实体身份、事件关联、主张支持、分类六项结论及理由。新签名摄入窗口最长 60 秒；历史报告以原接收时间验证，不能将过期新报告冒充历史报告。

网站只持有公钥，不生成可信结论或持有签名私钥。**本次提供请求/报告接入和登记执行器；独立核验服务的实际资料调查、模型执行与签名部署尚未实现。** 必须确定可信核验主体及运行位置，不能用 Web 进程自签代替。

## 数据库与配置

`0023_candidate_materials.sql` 新增三个追加式私表：`candidate_material_requests`、`candidate_material_reports`、`candidate_material_receipts`。包含 owner/请求/报告复合外键、摘要唯一约束、更新/删除/清空防护。

生产准备需要另行批准迁移和最小授权：

- `db/roles/create_material_registration_roles.sql`：创建空凭证受限角色，不含密码。
- `db/roles/configure_material_registration.sql`：精确授权与自检，不扩大已有 reader/reviewer。
- `HZENSE_MATERIAL_REGISTRAR_DATABASE_URL`、`HZENSE_MATERIAL_VERIFIER_DATABASE_URL`：对应专用角色。
- `HZENSE_MATERIAL_TRUSTED_VERIFIERS`：key ID 到 `{publicKey,verifierId}` 的 JSON 映射，仅公钥。
- `HZENSE_MATERIAL_WORKER_TOKEN`：至少 32 字符，不能放入客户端或仓库。
- `HZENSE_MATERIAL_REGISTRATION_ENABLED=1`：新写入开关，缺省关闭。

关闭开关停止创建、报告摄入和登记，保留只读历史；不要删除审计表作为回滚。现有公开信号数据源、发布开关、预算保持不变。

## 验证与上线门禁

测试覆盖补证包、签名、冲突、角色矩阵、隔离、字段/来源绑定与浏览器确认交互。真实 PostgreSQL 角色测试已接入 `test:migrations`，须在隔离数据库执行后才能声称数据库链路验收通过。

生产启用需另行确认：备份和迁移核验 → 最小授权 → 独立核验服务、公钥配置 → 一条合成资料闭环 → 刷新确认持久化。页面按钮出现、登记成功和正式发布成功是不同结论。
