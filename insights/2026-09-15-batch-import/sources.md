# 来源与证据

核对时间：2026-09-15。仓库基线为 `fb71ec82fd2d6b10cd548b13575e49d03fa1d6fe`；以下行号对应核对时版本，后续以链接文件与提交为准。

## 仓库事实

- **R1 — 顺序与授权边界：** [docs/SIGNAL_WORKBENCH.md](../../docs/SIGNAL_WORKBENCH.md)，第 8–20 行。第二阶段包含全部指定文件／表格／OCR、混合输入、进度、错误和重试；生产角色、Secret、费用与公开切换分开授权。
- **R2 — 产品输入契约：** [docs/SIGNAL_FIRST_REDESIGN.md](../../docs/SIGNAL_FIRST_REDESIGN.md)，第 289–353 行。格式、限制、私有原件、定位、去重、保留、取消与发表意图；不能以文本解析替代 OCR 验收。
- **R3 — 流水线契约：** [docs/AUTONOMOUS_SIGNAL_PIPELINE.md](../../docs/AUTONOMOUS_SIGNAL_PIPELINE.md)，第 115–190、210–242 行。异步运行、事件时间、独立证据、预算、租约与 fencing；文档计数不同于事件计数。
- **R4 — 现有物理表：** [packages/database/src/schema.ts](../../packages/database/src/schema.ts)、[db/migrations](../../db/migrations)。基线到 `0013`，没有私有批次／原件版本／解析任务表。`sources` 是来源身份，`public_source_evidence` 是公开证据，不是上传暂存区。
- **R5 — 公开资格依赖：** [0012_current_signal_publication.sql](../../db/migrations/0012_current_signal_publication.sql)，第 22–48、128–142、266 行。来源整行参与 seal，来源更新触发失效；采集运行状态不得塞入该表。
- **R6 — 现有安全边界：** [admin-auth.ts](../../apps/web/lib/server/admin-auth.ts)、[admin-ai-core.ts](../../apps/web/lib/admin-ai-core.ts)、[ai-provider-transport.ts](../../apps/web/lib/ai-provider-transport.ts)。可参考会话、同源、请求大小和固定 DNS 连接模式；AI 传输器会携带供应商凭证，不能直接作为通用网页抓取器。

## 官方平台资料

- **E1 — 浏览器直传：** [Vercel Blob Client Uploads](https://vercel.com/docs/vercel-blob/client-upload)。官方说明大于 4.5 MB 的文件可浏览器直传，服务端发凭证之前必须鉴权和授权。本文只据此选传输边界，不直接复制示例中的日志、宽泛错误或客户端信任方式。
- **E2 — 私有存储：** [Private Blob GA](https://vercel.com/changelog/vercel-private-blob-is-now-generally-available)。当前公告提供私有访问与短期身份能力；接线时须再次核对锁定 SDK 的直传、回调校验及 OIDC 支持，不能假设所有上传 API 都无需静态凭证。
- **E3 — 隔离运行候选：** [Vercel Sandbox](https://vercel.com/docs/sandbox)。作为线上隔离解析运行时的候选，不据此承诺调度持久性、完整文档格式、OCR、费用或本项目已配置。实际限制、生命周期及网络策略需要适配测试。

本增量的测试不访问上述平台。没有上传用户文档、读取生产 Secret、运行数据库迁移或调用付费模型；官方能力说明不是本项目端到端验收证据。
