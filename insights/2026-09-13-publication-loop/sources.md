# 设计依据

## 项目内事实

- [候选核验契约](../../docs/SIGNAL_CANDIDATE_VERIFICATION.md)：核验记录、精确材料指纹、已封存组装；历史核验回执不是当前公开许可。
- [原私有发表](../../docs/SIGNAL_QUALIFIED_PUBLICATION.md)：结构资格与受控运行门禁，不提供公开 Reader。
- [永久 Outbox](../../docs/SIGNAL_PUBLICATION_OUTBOX.md)：内容版本和发表修订分离；重放不得推进当前状态。
- [发布控制](../../docs/SIGNAL_PUBLICATION_CONTROLS.md)：总开关、任务策略、原始意图、授权及运行租约。
- [管理员认证](../../docs/ADMIN_AUTH.md)：服务端 Google 会话和单账号白名单；页面布局不能代替 API 授权。

## 外部机制依据

- [PostgreSQL 18 CREATE VIEW](https://www.postgresql.org/docs/18/sql-createview.html)：视图每次读取执行查询；`security_barrier` 与 owner/invoker 权限边界。
- [PostgreSQL 18 GRANT](https://www.postgresql.org/docs/18/sql-grant.html)：SELECT 与行锁所需权限不同，不能为锁共享来源而扩大 Publisher 更新权限。
- [Next.js Route Segment Config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config)：动态路由和缓存边界。

以上机制仅支持设计选择；具体隔离、并发与返回内容必须以项目回归测试验证。生产上线事实单独存档，不以设计文档代替。
