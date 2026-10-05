# Signal 统一物理存储：阶段 A

[事实] 当前实现已具备新版内容契约、历史归档／人工全修订转换和只读预演适配器；未实施 DDL 或上线切换。

- [设计与实施边界](../../docs/UNIFIED_SIGNAL_STORAGE.md)：目标表、字段、发布依据、后续门禁。
- [自评](review.md)：风险和待解决事项。
- [来源](sources.md)：本仓库证据。

代码位于 `packages/database/src/unified-signal-*.mjs`，回归位于对应 `test/unified-signal-*.test.mjs`。
本地新版测试 22 项通过；数据库包默认 2,979 项通过、738 项环境测试跳过，类型／lint／格式通过。
不使用第三方研究或 AI 调用；不改变生产数据库。用户同意的目标是统一主存储，而非保留三套来源只做页面合并。
