# 待审核 Signal 分类型复审来源

核验日期：2026-09-29。只读核验原始网页／官方文件，不调用付费生成，不操作生产库。动态网页可能变化，详细读取结果和访问失败说明分别保留在三个分组报告。

## 本地规则与范围

- [分类型信息规则 v1](../2026-09-29-signal-type-rules/design-doc.md)：本次评审口径，不代表已修改生产门禁。
- [此前确认账本](../2026-09-29-daily-signal-review/publication.json)：仅其 `deferred` 中 11 条纳入本批，不重审已确认的 28 条。
- [7–8 月候选](../2026-09-29-daily-signal-review/july-august-candidates.yaml)与[9 月候选](../2026-09-29-daily-signal-review/september-candidates.yaml)：原稿及旧审核依据，原样保留。
- [结构审计](structural-audit.json)：当前原稿哈希、规则文档哈希及目录登记差异。结构有效不证明新闻事实正确。

## 原始来源入口

| 编号 | 候选／日期                 | 原始来源                                                                                                                                                                                     | 支持范围与限制                                                                                  |
| ---- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| P1   | 开放权重联名信，07-24      | [NVIDIA 托管的联名信](https://images.nvidia.com/pdf/Open-Weights-and-American-AI-Leadership.pdf)                                                                                             | 倡议正文与组织签署；名单版本差异须保留，不把现有全名单回填成首批                                |
| F1   | 长鑫上市，07-27            | [上交所上市公告](https://www.sse.com.cn/disclosure/announcement/listing/ipo/c/c_20260724_10826610.shtml)、[上市公告书](https://static.cninfo.com.cn/finalpage/2026-07-24/1225439534.PDF)     | 上市主体、日期、市场、发行信息；不由股价推导技术能力                                            |
| P2   | 商务部回应 FCC，07-30      | [商务部原入口](https://video.mofcom.gov.cn/xwfb/2026/7/0d481ba8e61e41beb9e7edd592963871902.html)、[商务部关联全文](https://cacs.mofcom.gov.cn/article/gnwjmdt/sb/zm/202607/188785.html)      | 中方表态及条件性反制，不等于措施已执行；可读取原创全文另见分组报告                              |
| R1   | ECB 风险研究，08-17        | [ECB Blog 原文](https://www.ecb.europa.eu/press/blog/date/2026/html/ecb.blog20260817~754a8a4418.fi.html)                                                                                     | 作者署名与研究观点，不等于央行正式政策或必然预测                                                |
| F2   | 宇树上市，08-19            | [上交所上市公告](https://www.sse.com.cn/disclosure/announcement/listing/ipo/c/c_20260818_10829204.shtml)、[发行结果公告](https://static.cninfo.com.cn/finalpage/2026-08-14/1225472623.PDF)   | 上市日期、发行价和配售参与者；按文件明确的投资角色关联，不将承销商自动当投资方                  |
| F3   | 阿里配售，08-26            | [完成公告](https://home.alibabagroup.com/en-US/document-2029365886510432256)、[此前定价公告](https://home.alibabagroup.com/en-US/document-2028384807859257344)                               | 完成日与融资金额支持当前 Signal；定价页网页日期与正文日期不同，不沿用旧审核注记的简单两日时间线 |
| P3   | 美国三机构蒸馏公告，09-08  | [NSA 官方公告](https://www.nsa.gov/Press-Room/Press-Releases-Statements/Press-Release-View/Article/4592113/nsa-and-others-warn-china-based-ai-companies-are-distilling-us-frontier-ai-mode/) | 美方机构的威胁描述、指控及防护建议，不是法院认定；正文支持按安全事件／威胁披露审查              |
| R2   | OpenAI 失配披露框架，09-16 | [OpenAI 框架公告](https://openai.com/index/model-misalignment-reporting-framework/)                                                                                                          | 企业披露框架和案例发布，不是强制行业法规                                                        |
| R3   | Anthropic 研发测量，09-17  | [研究正文](https://www.anthropic.com/institute/measuring-pace-of-ai-development)、[官方 Research 列表](https://www.anthropic.com/research)                                                   | 作者、指标口径及发表日期；内部测量不等于第三方验证或全行业比例                                  |
| R4   | OpenAI DNS 外联事件，09-20 | [OpenAI 原始事件报告](https://alignment.openai.com/misalignment-reports/an-agent-used-dns-to-reach-an-external-chatbot/)                                                                     | 事件／发现日与 09-25 更新分开；处置时延需明确计时起点，暂停范围及未完成调查均截至报告日         |
| P4   | 中美 AI 沟通渠道，09-26    | [中国使馆官方成果稿](https://gq.china-embassy.gov.cn/zxxx/202609/t20260926_12031616.htm)                                                                                                     | 建立对话与渠道的同意／计划，不证明技术渠道已开通；人物角色补充证据见分组报告                    |

## 使用边界

官方原文是“该方作出此披露”的一手依据，不意味着其中的效果、指控和估计均经独立确认。缺具名人物可以按类型不阻断；已有明确核心作者或投资角色则不能因原稿漏填而标记为“不适用”。未访问成功的附件不能标记为已经核验全文。
