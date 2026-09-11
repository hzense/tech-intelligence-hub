# datas 候选正式 Seed 导入记录

记录时间：`2026-09-11T22:09:03Z`。范围：本地 Seed，不包含生产执行。

## 结果

操作者要求加入正式 Signals，且时间使用事件发生时间而非采集时间。102 条已接受候选中，66 条来源与日期达到本轮导入条件，36 条仍暂缓。原有 16 条保留，正式 Seed 共 82 条；来源登记增至 45 个，并为已有 Taxonomy 节点增加 Autonomous Systems Topic 投影。没有创建新实体，实体关联只使用已有且明确匹配的 ID。

机器可读台账见 [seed-promotion.json](seed-promotion.json)，含全部 102 条决定、候选与正式 ID、日期类型、日期依据 URL、编辑评分及暂缓原因。候选原摘要、原始日期建议、采集时间、人工接受记录及文件溯源保留。

## 时间规则

- `occurred_at` 表示当前 Signal 所记录事件的日期：如订阅暂停、奠基、生效；如果 Signal 是公告、财报、研究发表或事故披露，则使用该发布 / 披露日，不冒充底层活动发生日。
- `captured_at` 保持原始采集时间 `2026-09-11T21:15:59Z`，不回填历史日期，也不拿它给事件排序。
- 66 条均只确认到天；沿用仓库既有 `00:00:00Z` 日期存储约定，不声称准确事件时刻或把来源当地日误称 UTC 瞬间。精度单独记录为 `day`。
- Kimi：7 月 20 日报道正文称 Sunday，换算事件日为 **7 月 19 日**；[报道](https://www.investing.com/news/stock-market-news/chinas-moonshot-pauses-kimi-subscriptions-amid-hot-demand-ipo-push-4800006)。
- Waymo 慕尼黑：[官方公告](https://waymo.com/blog/2026/08/waymo-in-munich)为 **8 月 25 日**，不用材料的 8 月 26 日。
- SK 海力士：[8 月 28 日公告](https://news.skhynix.com/en/groundbreaking-ceremony-in-indiana/)明确仪式在美国当地 **8 月 27 日**，按仪式日记录。
- PJM 电价研究：[原始研究](https://newsletter.semianalysis.com/p/are-ai-datacenters-increasing-electric)发表于 **3 月 3 日**，不按八月收录材料日期伪装成新研究。
- 个别媒体跟进是独立的“报道事件”，如联合报对中美 AI 对话筹备的 9 月 5 日报道；标题、摘要和台账明确归属，不表示对话已经举行。

## 证据及评分边界

可读取页面及日期核对不等于所有事实已独立复测。正式摘要已去掉提取占位文案，保留来源归属、计划 / 协议 / 传闻等状态，不把论文候选结果、未来容量或合同值写成已实现事实。原始候选 `verification: document_only` 和 `source_check` 是历史阶段记录；本次日期核对另记 `date_verification` 与导入台账。

正式 Seed 必填的四项评分是本轮编辑估计：研究通常 importance 3 / strength 2 / confidence 0.75 / novelty 0.6；主要官方产品、合作、安全或收购公告 importance 4 / strength 3 / confidence 0.85 / novelty 0.7；转述报道 strength 2 / confidence 0.75，价格传闻降至 strength 1 / confidence 0.6。逐条实际值以台账为准，不代表概率校准、投资建议或独立性能验证。

## 暂缓的 36 条

保留接受状态，但不加入正式 Seed；待补足原文或日期、拆分混合事件后再导入。访问失败不等于事件为假。

| 候选 ID                                                      | 暂缓原因                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `candidate-datas-tsmc-arizona-expansion`                     | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-china-compute-robot-statistics`             | 机器人统计原文已定位；算力数据另见 8 月 5 日报道，不能据此证明 7 月 20 日已经披露同一算力数据。    |
| `candidate-datas-us-china-ai-talks-planning-july`            | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-open-weight-industry-letter`                | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-nvidia-openai-guarantee-july-report`        | 目前只定位 7 月 27 日转载，材料称 26 日首报；原始披露时间及传闻交易阶段未核清。                    |
| `candidate-datas-cxmt-ipo`                                   | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-china-duv-manufacturing-report`             | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-china-robot-restriction-response`           | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-amazon-openai-investment-completion-report` | 原 FT 链接本次无法读取；已定位 Amazon 季报，但不能据此自动认定该笔投资完成，到账条件和金额待核实。 |
| `candidate-datas-us-voluntary-ai-cyber-testing`              | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-unitree-ipo-valuation-report`               | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-anthropic-custom-chip-team`                 | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-allianz-ai-it-retirement`                   | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-softbank-quarterly-ai-investments`          | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-china-ai-video-funding-report`              | 一条候选汇总多笔融资，不能用 8 月 7 日综述发布日期充当每笔融资发生时间，待拆分。                   |
| `candidate-datas-china-autonomous-driving-safety-standard`   | 原文仅称近日获批，精确国标发布日期不明；不能用 8 月 7 日报道日替代。                               |
| `candidate-datas-apple-qwen-china-documentation`             | 备用报道支持接入指南线索，但未核实原指南撤下过程及发布时间，不能证明现时可用。                     |
| `candidate-datas-china-ai-patent-statistics`                 | 汇总统计期与多项指标混合，披露事件需拆分确认，不能强行给统一发生日。                               |
| `candidate-datas-semianalysis-spacex-10gw`                   | 页面已返回，但标题/正文所列收入模型口径不一致；须确认版本，不将研究预测当作实际收入。              |
| `candidate-datas-nvidia-openai-guarantee-revision-report`    | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-nvidia-sb-energy-investment-report`         | 本轮未取得可确认的原文发布日期及充分正文，传闻日期待核对。                                         |
| `candidate-datas-ecb-ai-equity-risk-analysis`                | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-unitree-world-model-comments`               | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-alibaba-ai-share-placement`                 | 转载说明配售及股价变化，但协议签署、公告及交割日期未区分核定。                                     |
| `candidate-datas-taiwan-b300-indictment`                     | 正文称日前起诉，没有给出精确起诉日，不使用 8 月 24 日报道日冒充。                                  |
| `candidate-datas-miit-ai-standards-6g`                       | 已定位 6G 相关报道；AI 标准化数量与计划仍需单独的精确公告，不能用同段背景链接代替。                |
| `candidate-datas-cursor-anthropic-followup`                  | 备用报道可定位模型供应争议；Cursor 与 Anthropic 各自声明及适用范围仍待核对。                       |
| `candidate-datas-openai-autoshutdown-letter-report`          | 本次检索无法读取首选链接；这是访问限制或检索错误，不等于已经证明事件为假。                         |
| `candidate-datas-foxconn-august-ai-server-sales`             | 原 Reuters 链接无法读取；材料附带的鸿海链接对应季度财报而非八月营收，未采用为替代来源。            |
| `candidate-datas-inferencex-deepseek-v4-rankings`            | 可访问动态榜单，但没有取得 2026-09-03 的冻结版本与测试配置，不能证明历史排名。                     |
| `candidate-datas-tcs-hypervault-hyderabad`                   | TCS 页面本次未返回可确认的公告日期，不以材料日期填充。                                             |
| `candidate-datas-isar-spectrum-orbit`                        | 已读报道未明确起飞日期，不能用 9 月 6 日更新时刻或材料中的 9 月 5 日推定。                         |
| `candidate-datas-mistral-funding`                            | 原 Reuters 链接无法读取；另有官方基础设施页面，但未证明本轮融资金额、估值和交割。                  |
| `candidate-datas-us-agencies-distillation-advisory`          | 已定位美方公告；属于发布方指控，不是独立裁定；中方回应须补对应独立原文。                           |
| `candidate-datas-semianalysis-robot-inference`               | 直接打开失败（初次返回 404），搜索索引返回同一文章内容；未取得可实时读取原文，不视为全文核验完成。 |
| `candidate-datas-enflame-stock-market-debut`                 | 原 Reuters 首日交易报道无法读取；上市公告转载只能补计划上市信息，首日交易情况仍待核实。            |

## 验证

- 内容包测试：8 个文件、66 项通过，包括候选导入映射、日期与采集时间分离、暂缓项不导入及四个日期回归用例。
- 内容校验：Topic 权威、11 份内容文件及交叉引用通过；新增自主系统 Topic 内容页与 Seed 投影配套。
- 内容包 TypeScript 类型检查、修改测试的 ESLint、变更文件 Prettier 检查及 `git diff --check` 通过。
- 保留性核对：原有 16 条 Signal、此前 38 个 Source、102 条候选的原摘要 / 原日期建议 / 采集时间 / 来源检查 / 溯源，以及人工接受范围均未改变；全部正式事件键唯一。

首次从仓库根目录调用内容测试时，旧测试依赖包目录且误包含 `.pr55v2` 的副本，导致路径错误；已改从 `packages/content` 运行完整内容测试并通过。没有修改或清理该副本。

以上均为本地验证；未提交、未部署、未执行数据库或搜索索引同步。
