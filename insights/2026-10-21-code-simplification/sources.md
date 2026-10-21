# 来源与核验依据

均为 2026-10-21 当前仓库只读分析；基线提交 `0306a6124d351ae1f26cf06aab8ca771801ac552`。

| 来源                                                                                                                                   | 支持的事实                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/page.tsx`、`apps/web/lib/public-exploration-runtime.ts`、`apps/web/lib/signal-radar-model.ts`                            | 当前首页使用公开 Signal 构建交互雷达，不使用旧快照页面适配器                                                                |
| `apps/web/components/candidate-review.tsx`、`apps/web/app/admin/(protected)/signal-review/[id]/[index]/history/page.tsx`               | 当前编辑器是 EditorialPublicationEditor；历史核验仍使用 CandidatePublicationActions，不能删除                               |
| 基线 `apps/web/components/candidate-review-editor.tsx` 及仓库引用检索                                                                  | 旧编辑器仅被专属单测和混合浏览器测试引用，没有运行时入口                                                                    |
| `packages/database/src/editorial-vector-manifest.mjs`、`editorial-vector-query.mjs`、`editorial-signal-role.mjs`                       | pgvector 校验继续使用完整记录与重复敏感的数据库比较，不能删字段或改变 SQL                                                   |
| `packages/database/test/editorial-vector-validation.test.mjs`                                                                          | 基线 118 条记录序列化 SHA-256 为 `46c69266cb15e4584b611781b7392f2a1d3e1b78edea655cf2023b064ecc9d96`；另核验可变子对象不共享 |
| `apps/web/components/candidate-material-workflow.tsx`                                                                                  | 四处补证 POST 原先使用相同编码、65 秒超时和 JSON 错误处理                                                                   |
| `apps/web/lib/server/editorial-review.ts`、`apps/web/lib/server/material-registration.ts`、`apps/web/lib/server/signal-publication.ts` | 补证、旧核验和受限发布仍有实际调用，不应批量删除                                                                            |

统计使用 Git 跟踪文件及本轮未忽略的新文件，排除已删除文件；不是依赖包大小、部署大小或有效语句数。未使用线上账单、生产查询或供应商调用。
