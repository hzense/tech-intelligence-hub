# 2026-11-02 信号事件类型核定

本次依据版本库已有信号的标题和摘要重新区分事件类型，没有重新核验新闻真实性、来源内容或日期。原始 Seed 共 110 条，其中 26 条使用已退出的新分类项；其余 84 条保持现有事件类型。

原 Seed 和归档哈希不变，以下记录为公开展示的逐条分类映射。数据库存量不写回；生成任务及其候选不修改。匹配要求为 ID、原类型、标题、摘要全部相同，正文改变后不会继续套用旧映射。

| 信号 ID                                                  | 标题                                                      | 原类型         | 新事件类型                     |
| -------------------------------------------------------- | --------------------------------------------------------- | -------------- | ------------------------------ |
| `signal-20260910-skild-nvidia-physical-ai`               | NVIDIA 披露 Skild S1 机器人模型的训练、仿真与部署技术合作 | `technology`   | 合作签约（`partnership`）      |
| `signal-20260910-anthropic-threat-report`                | Anthropic 发布 2026 年 9 月 AI 滥用威胁情报报告           | `security`     | 研究成果发布（`research`）     |
| `signal-20260721-openai-huggingface-evaluation-incident` | OpenAI 披露涉及 Hugging Face 的模型评估安全事故           | `security`     | 事故事件（`incident`）         |
| `signal-20260722-alphabet-q2-results`                    | Alphabet 二季度云收入与资本开支披露                       | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260723-intel-q2-results`                       | Intel 二季度 AI 数据中心业务与代工披露                    | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260729-skhynix-q2-results`                     | SK 海力士发布 2026 年第二季度财报                         | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260729-microsoft-fy26-q4-results`              | 微软财季披露 Azure 与 Copilot 业务数据                    | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260729-meta-q2-results`                        | Meta 二季度披露 AI 资本开支与现金流压力                   | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260730-amazon-q2-ai-capex`                     | Amazon 二季度 AWS 增长与 AI 资本开支披露                  | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260804-aisi-agent-cyber-evaluation`            | 英国 AISI 智能体网络安全评估披露                          | `security`     | 研究成果发布（`research`）     |
| `signal-20260804-amd-q2-results`                         | AMD 二季度数据中心收入披露                                | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260820-nvidia-china-lpu-denial`                | NVIDIA 否认面向中国推出特制 LPU 的报道                    | `supply_chain` | 经营与信息披露（`disclosure`） |
| `signal-20260822-nvidia-server-price-report`             | 媒体报道部分 NVIDIA AI 服务器拟涨价                       | `supply_chain` | 经营与信息披露（`disclosure`） |
| `signal-20260825-openai-jalapeno-results`                | OpenAI 披露 Jalapeño 推理芯片首批结果                     | `technology`   | 研究成果发布（`research`）     |
| `signal-20260826-nvidia-fy27-q2-results`                 | NVIDIA 发布 2027 财年第二季度业绩                         | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260827-skhynix-indiana-groundbreaking`         | SK 海力士美国先进封装基地奠基                             | `supply_chain` | 建设投产（`operations`）       |
| `signal-20260829-cxmt-lpddr6-production`                 | 长鑫 LPDDR6 量产与小米终端适配                            | `supply_chain` | 产品发布与更新（`product`）    |
| `signal-20260829-nda-compute-capacity-july`              | 国家数据局披露全国智能算力规模                            | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260901-openai-astra-critical-cyber`            | OpenAI 披露 Astra 网络安全能力分级                        | `security`     | 研究成果发布（`research`）     |
| `signal-20260902-china-ic-production-statistics`         | 媒体报道中国集成电路产销数据                              | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260716-tsmc-ai-arizona-guidance`               | 台积电在二季度业绩会上披露 AI 需求和亚利桑那投资计划      | `supply_chain` | 建设投产（`operations`）       |
| `signal-20260806-softbank-q1-fy2026-ai-investments`      | SoftBank Group 发布 FY2026 第一季度业绩与 AI 投资资料     | `market`       | 经营与信息披露（`disclosure`） |
| `signal-20260905-tcs-hypervault-hyderabad`               | TCS HyperVault 公布海得拉巴最高 1GW AI 数据中心园区计划   | `market`       | 建设投产（`operations`）       |
| `signal-20260618-openai-medicare-portal`                 | 澳大利亚政府披露 OpenAI Agent 未授权访问医保统计门户      | `security`     | 事故事件（`incident`）         |
| `signal-20260908-us-agencies-ai-distillation-advisory`   | 美国三机构就针对前沿 AI 模型的蒸馏活动发布安全公告        | `security`     | 经营与信息披露（`disclosure`） |
| `signal-20260920-openai-agent-dns-egress`                | OpenAI 披露内部 Agent 经 DNS 绕过受限网络访问外部服务     | `security`     | 事故事件（`incident`）         |

分类边界：报告发布按研究成果归类；风险公告不直接认定事故已经发生；财报中的投资信息按业绩披露的核心事件归类；建设计划与募集资金区分，规划不改写为已投产。

结构与规则见 [信号事件类型](../SIGNAL_EVENT_TYPES.md)。
