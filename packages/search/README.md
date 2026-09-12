# @hzense/search：搜索协议与数据库检索

`@hzense/search` 负责 HZense 的统一搜索规则：哪些内容可以进入搜索、如何转换为搜索文档、如何匹配和排序，以及如何校验数据库返回结果。

- **FTS-0**：从网站中提取进程内搜索逻辑，统一排序规则和标准搜索文档。
- **FTS-1**：在保留上述搜索行为的基础上，增加 PostgreSQL 搜索投影、固定参数化查询和结果校验。FTS 是 Full-Text Search（全文检索）的缩写；本阶段不包含向量嵌入、混合检索或 RAG 问答。

本文描述当前已实现的搜索能力。Signal-first v2 的新内容模型及搜索自动同步属于后续开发，不能将[重构设计](../../docs/SIGNAL_FIRST_REDESIGN.md)视为已实现功能。

## 代码结构与导入入口

| 文件                                     | 导入入口                    | 职责                                                             |
| ---------------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| [src/projection.ts](./src/projection.ts) | `@hzense/search/projection` | 发布状态过滤、标准搜索文档、稳定序列化、SHA-256 指纹及数据库投影 |
| [src/ranking.ts](./src/ranking.ts)       | `@hzense/search/ranking`    | 查询校验、文本归一化、子串匹配、加权评分和稳定排序               |
| [src/database.ts](./src/database.ts)     | `@hzense/search/database`   | 固定参数化 SQL、查询参数准备、数据库行校验和结果映射             |
| [src/index.ts](./src/index.ts)           | `@hzense/search`            | 汇总导出上述能力                                                 |

服务端生成投影时使用 `@hzense/search/projection`。只需要排序功能时使用 `@hzense/search/ranking`，避免通过总入口加载依赖 Node.js `crypto` 的指纹实现。

数据库连接与事务同步不由本包直接管理：

- [数据库同步模块](../database/src/search-sync.mjs)负责事务、预演、指纹核对、失效搜索行清理和加锁后的写入验证。
- [网站搜索入口](../../apps/web/lib/server/search.ts)负责接入运行时数据库读取与搜索模式。
- [迁移 0003](../../db/migrations/0003_search_documents_fts.sql)负责搜索表字段、加权 `tsvector`、GIN 索引和完整性约束。已提交的迁移应保持不可变，更改结构时追加新迁移。

## 可进入搜索的内容

当前支持六类公开内容：日报 `daily`、周报 `weekly`、洞察 `insight`、专题 `topic`、信号 `signal` 和资源 `resource`。

调用方必须通过 `SearchProjectionCandidate.publication` 传入来源的真实状态。候选只能通过 `projectPublishedSearchDocument` 或批量版本 `projectPublishedSearchDocuments` 转为标准搜索文档；允许的状态如下：

| 来源类型         | 允许进入搜索的状态                |
| ---------------- | --------------------------------- |
| 日报、周报、洞察 | `published`                       |
| 专题             | `watching`、`active`、`strategic` |
| 信号             | `reviewed`、`accepted`            |
| 资源             | `active`                          |

其他状态均被排除，包括草稿、待审核的编辑内容、收件箱或被拒绝的信号、已归档专题和非活跃资源。即使上游加载器错误地传入这些候选，投影入口也不会将其纳入搜索。

`search_documents` 是由公开内容派生的搜索索引，不是内容权威来源。索引同步不等于向业务 `signals` 表导入数据，搜索文档总数也不等于信号总数。

## 标准搜索文档

`CanonicalSearchDocument` 保存来源身份、显示字段及重建搜索结果所需的信息，例如：

```ts
import type { CanonicalSearchDocument } from '@hzense/search/projection';

const document: CanonicalSearchDocument = {
  id: 'searchdoc-insight-insight-agent-security-boundary',
  sourceId: 'insight-agent-security-boundary',
  sourceType: 'insight',
  title: 'AI 安全边界正扩展到智能体系统',
  summary: '...',
  href: '/insights/insight-agent-security-boundary',
  keywords: '...',
  body: '...',
  importance: 4,
  documentDate: '2024-06-22',
  topics: ['topic-ai-agents', 'topic-ai-security'],
  entities: ['company-anthropic'],
};
```

- `documentDate` 为 `string | null`，有日期时使用 `YYYY-MM-DD`；专题和资源不虚构日期。
- 投影 ID 按 `searchdoc-${sourceType}-${sourceId}` 生成，区分不同来源类型。
- `importance` 必须为 1–5 的整数，是投影元数据，不直接参与当前文本匹配得分。
- `toSearchDocument` 转回网站使用的 `id`、`type` 和可选 `date` 结构，保留原有路由、结果标识、筛选与展示约定。

迁移 `0003_search_documents_fts.sql` 增加 `summary`、`href`、`keywords`、四个归一化文本列以及生成列 `search_vector`。如果旧搜索表已有数据，迁移会拒绝缺失字段的隐式补填；需按审核后的维护流程处理，再由同步器从权威来源重建派生数据，不应直接清空生产表重试。

## 稳定序列化与指纹

生成投影时会统一换行符、去除首尾空白、合并关键词中的连续空白，并对专题和实体 ID 去重、排序。

`serializeCanonicalSearchDocuments` 将文档按 ID 的确定性字符串顺序排列，以固定字段顺序输出带版本号的紧凑 JSON；重复文档 ID 会报错。`fingerprintCanonicalSearchDocuments` 对 UTF-8 序列化结果计算 SHA-256，返回 `sha256:<hex>`。

指纹用于判断两次投影是否一致，以及核对重建和同步结果。它不是内容权威来源，也不是向量嵌入的指纹。

## 查询、匹配与排序规则

三种网站搜索模式共用输入限制：原始查询长度不超过 120（按 JavaScript `string.length` 计），归一化后最多包含 24 个不同关键词。页面先校验查询，再选择搜索模式；非法输入不会进入影子比对或创建数据库连接。网站入口对空查询直接返回空结果，不执行数据库检索。

排序协议版本为 `SEARCH_RANKING_CONTRACT.version = 'nfkc-whitespace-substring-v1'`：

1. 文本进行 NFKC 归一化、按 `zh-CN` 转为小写，并合并 Unicode 空白。
2. 查询只按空白拆分并去重，不进行中文分词。
3. 每个关键词都必须作为字面子串出现在归一化后的标题、摘要、关键词或正文中。
4. 每个词在标题、摘要、关键词中的出现次数分别乘以 8、4、3；正文匹配次数最多计 4 分。完整查询出现在标题、摘要、关键词中时，分别再加 12、6、3 分。
5. 结果依次按得分降序、日期降序、`zh-CN` 标题升序排列；仍相同时，按类型和来源文档 ID 的确定性字符串顺序排列，避免结果随输入遍历顺序变化。

[中英文基准样例](./test/fixtures/search-ranking-golden.json)覆盖中文、英文、全角 Unicode、标点、类型筛选、标题与正文权重，以及完全同分时的最终排序规则。

PostgreSQL 的加权 `tsvector` 使用内置 `simple` 配置，但其分词行为不能完全复现中文及任意字面子串匹配。因此，当前 FTS-1 查询仍基于应用生成的归一化列进行过滤和评分，并使用共享的 JavaScript 比较器完成最终排序。GIN 索引已建立，可供后续候选检索使用；当前查询不依赖它，不能在不另行定义排序协议版本并验收的情况下直接替换兼容查询。

## 网站搜索模式

通过 `HZENSE_SEARCH_MODE` 选择模式：

| 模式         | 对用户返回的结果                       | 数据库异常时的行为                                       |
| ------------ | -------------------------------------- | -------------------------------------------------------- |
| `in-process` | 进程内搜索结果                         | 不使用数据库搜索路径                                     |
| `shadow`     | 始终返回进程内结果，同时比对数据库结果 | 记录数据库不可用，不用数据库结果替换页面结果             |
| `database`   | 数据库搜索结果                         | 错误向上传递，由页面错误边界处理，不自动回退到进程内搜索 |

环境变量未设置时默认使用 `in-process`；这只是代码默认值，不能据此判断生产配置。无效模式值会报错。数据库搜索复用既有 Runtime 连接池，每个进程的连接池上限为 1，不代表所有服务实例合计只有一个连接。

## 生产上线与维护边界

根据 [2026-09-11 生产切换验收记录](../../docs/production-evidence/acl/34535908960-1/cutover.md)，当时已完成迁移 `0003`、搜索投影回填、Runtime 列级权限预检、影子比对及 `HZENSE_SEARCH_MODE=database` 的部署验收。[后续批次同步记录](../../docs/production-evidence/2026-09-12-signals-search-sync.md)另行记录了该批内容的索引写入与独立零差异复核。

这些链接是历史验收证据，不是实时生产状态检查。代码交付、PR 合并、索引同步和生产模式切换是不同阶段，不能相互替代。

生产维护采用受保护的线上工作流，见[全线上生产维护](../../docs/ONLINE_MAINTENANCE.md)和[部署文档](../../docs/DEPLOYMENT.md)。正式写入需通过运行绑定审批、备份声明、投影与计划指纹核对等门禁；不可复用旧运行审批，不在本地保存或输入生产连接凭据。

上述历史记录中的备份恢复能力和历史 ACL 缺口均未验证；上线及后续索引同步不构成恢复验证证据。此前上线使用的是操作者明确接受风险的受限路径，不代表恢复验证通过，也不授权自动执行 ACL 权限规范化或恢复 SQL。

## 本地开发与验证

以下命令在仓库根目录执行：

```bash
pnpm --filter @hzense/search build
pnpm --filter @hzense/search typecheck
pnpm --filter @hzense/search lint
pnpm --filter @hzense/search test
```

需要验证同步器时，仅连接按项目说明配置的本地测试数据库：

```bash
pnpm db:sync:search:local:dry-run
pnpm db:sync:search:local:apply
```

`dry-run` 计算同步计划后回滚事务，不提交变更；`apply` 会修改目标测试数据库。上述命令不是生产维护入口，生产操作必须遵循前述线上流程。
