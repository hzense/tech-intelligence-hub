# 现有 Signal 人物与组织关系再核验

核验日期：2026-09-29。范围：71 条 Seed 中的 17 条组织空缺、3 条人物空缺，另补核既有 PORTS-Pike 公告的合作组织；此前本地补入的 Jakub Pachocki 关系保留既定角色边界。本文件提供可集成的数据建议，不直接修改 Seed。

## 结论

[事实] 17 条组织空缺的原文均包含可以明确标注关系的组织，主要是研究对象、被比较产品的供应方、政策回应方或受访企业。它们可按下表补足；这并不意味着研究文章的作者所在媒体就是事件组织。

[事实] 3 条人物空缺仍没有找到足以确认具名事件参与者的证据。AISI 网页署名为机构／团队；NVIDIA 的 LPU 否认由未具名发言人作出；价格报道以匿名消息为依据。保留空值。

[事实] 中国集成电路报道原文另外具名采访了张晓花、陈程，分别与四川顺芯和江苏扬贺扬形成清楚的人物—组织—事件关系，可同时补入。

## 可直接补入的组织关系

下列“原文支持”只证明组织与这篇研究或报道的关系；研究数字、预测和媒体转述仍维持原有置信度及限定语。`type` 保留单一值，人物、组织和 `topics` 可以多值。

| Signal ID                                              | 建议实体及 `entity_roles`                                                                                                                                                                                                      | 原文支持与边界                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signal-20260729-semianalysis-lego-datacenters`        | `company-amazon`：AWS 模块化数据中心设计的研究对象；`company-meta`：Prometheus 模块化机房案例的研究对象；可新增 `company-vertiv`：模块化电力、制冷与数据中心方案的研究对象                                                     | [S01] 正文 “The Labor Problem” 及 “Purpose-Built Rapid-Deployment Shells” 分别分析 AWS Houdini/SAMDC 与 Meta Prometheus；“All-in-One Prefab Datacenter Block” 分析 Vertiv MegaMod。不把这些公司标成研究报告作者。 |
| `signal-20260803-semianalysis-kimi-k3-architecture`    | `company-moonshot-ai`：被分析的 Kimi K3 模型及 FlashKDA 内核研发方                                                                                                                                                             | [S02] “FlashKDA Algorithm” 明确 Moonshot 开发并开源 FlashKDA；“Kimi Linear” 将 Moonshot 的模型设计与 K3 技术博客对照。                                                                                            |
| `signal-20260725-semianalysis-amd-cuda`                | `company-amd`：被分析的 GPU、ROCm 软件与机架方案供应方；`company-nvidia`：CUDA 生态及 GPU 架构的对比研究对象                                                                                                                   | [S03] 全文以 AMD Advancing AI 2026 为对象，“Designs Converging with NVIDIA” 和软件生态章节做直接比较。不将作者对竞争力的判断写成供应商认可的结论。                                                                |
| `signal-20260618-semianalysis-datacenter-cancellation` | 建议新增 `company-oracle`：Project Jupiter 数据中心延期与许可案例的研究对象；建议新增 `company-coreweave`：所用数据中心交付延期案例的研究对象                                                                                  | [S04] “Oracle/STACK New Mexico” 明确研究 Oracle 项目；“Real delays” 与 Core Scientific 案例明确关联 CoreWeave。角色应是报告分析对象，延期到 2029 是作者预测，不是 Oracle 已确认的交付安排。                       |
| `signal-20260810-semianalysis-tilert`                  | `company-nvidia`：TileRT 测试使用的 GPU 硬件供应方；可新增 `company-cerebras`：低延迟推理专用硬件的对比研究对象                                                                                                                | [S05] 文章题目和正文说明 TileRT 运行于 NVIDIA GPU，并比较 Cerebras 等专用推理系统。**不应写成 NVIDIA 是 TileRT 软件作者。**                                                                                       |
| `signal-20260303-semianalysis-pjm-load-forecast`       | 建议新增 `company-pjm-interconnection`：容量拍卖、负荷预测及电价机制的研究对象                                                                                                                                                 | [S06] 导言及 “PJM: The $16 Billion Simulation” 明确研究 PJM 的市场设计。PJM 官方将自身定义为区域输电组织 [S21]。此处保留公司法律实体，名称写 PJM Interconnection，不把它写成政府监管部门。                        |
| `signal-20260819-semianalysis-cerebras-cs4`            | 建议新增 `company-cerebras`：被分析的 CS-4 系统研发与供应方                                                                                                                                                                    | [S07] “The Backpack Rack” 分析 Cerebras CS-4；公司官方发布亦确认 CS-4 产品归属 [S22]。当前 Signal 的事件是 8 月 19 日研究发表，不应改为 8 月 18 日产品发布。                                                      |
| `signal-20260625-semianalysis-us-grid-btm`             | `company-pjm-interconnection`：电网接入、容量认定和可靠容量约束的案例研究对象                                                                                                                                                  | [S08] “PJM” 段落直接分析接入队列、ELCC 与容量拍卖，足以建立有界关系。不把作者的全国容量预测归为 PJM 官方预测。                                                                                                    |
| `signal-20260821-semianalysis-open-models`             | `company-moonshot-ai`：Kimi 系列开放模型能力演进的研究对象；`company-openai`：GPT 系列对比模型供应方；`company-anthropic`：Claude 系列与代理产品对比研究对象                                                                   | [S09] “Era 3” 比较 Kimi 与 GPT、Claude 的演进；[S02] 另证 Moonshot 与 Kimi 的所属关系。不据此推断三家公司联合开展研究。                                                                                           |
| `signal-20260824-semianalysis-agentx`                  | `company-amd`：AgentX 测试中的 GPU 与 ATOM 推理软件供应方；`company-nvidia`：AgentX 测试中的 GPU 与推理软件对比对象                                                                                                            | [S10] AgentX 正文包含 AMD ATOM 和 NVIDIA 平台的实际对比，并详述 AMD 代理负载优化。结论受模型与配置限制。                                                                                                          |
| `signal-20260816-semianalysis-pjm-modeling`            | `company-pjm-interconnection`：可靠容量模型与拍卖设计的研究对象                                                                                                                                                                | [S11] 开头和 “Context” 明确为重建 PJM Reserve Requirement Study 的研究；费用损失是作者模型主张，角色不能写成已被裁定违规的机构。                                                                                  |
| `signal-20260830-semianalysis-neocloud-security`       | `company-microsoft`：文中 Azure 环境安全检查的被测服务供应方；`company-coreweave`：文中安全检查比较的被测云服务供应方                                                                                                          | [S12] 文章后部直接对比 CoreWeave 与 Azure，且说明同一供应商的不同环境检查结果可能不同。不得标注为“全平台存在漏洞”；未具名的 Bronze 供应商继续匿名。                                                               |
| `signal-20260901-semianalysis-korea-sovereign-ai`      | `company-nvidia`：韩国主权 AI 算力供应及价值分配的研究对象；`company-sk-hynix`：韩国主权 AI 内存供应及价值分配的研究对象；`company-samsung-electronics`：韩国主权 AI 基础设施及供应链的研究对象                                | [S13] 标题与正文明确分析三者角色；部分采购条款是作者估计，不能写成已披露合同。                                                                                                                                    |
| `signal-20260902-china-ic-production-statistics`       | `institution-china-ndrc`：受访官员所属政策机构；建议新增 `company-sichuan-shunxin-semiconductor`：报道实地采访的芯片封装生产企业；建议新增 `company-jiangsu-yangheyang-microelectronics`：报道采访的存储芯片研发设计与销售企业 | [S14] 直接具名两家企业及负责人，并明确李超为国家发展改革委政策研究室副主任。无需将新华社放入事件实体。                                                                                                            |
| `signal-20260905-us-china-ai-talks-september-report`   | `institution-white-house`：报道引述的会期回应机构（否认当时已安排 9 月中旬相关会议）                                                                                                                                           | [S15] 原文同时保留路透对筹备的说法与白宫不同回应。可补白宫这一实际回应角色；不把匿名消息中的拟议会谈代表登记为已确定与会人。                                                                                      |
| `signal-20260907-semianalysis-tpu-inferencex`          | `company-google`：被测 Ironwood TPU 及云服务供应方；`company-nvidia`：B200/B300 GPU 推理对比对象                                                                                                                               | [S16] 导言明确 TPU 所属 Google，并说明与 B200/B300 的对比。成本优势仍标注为 SemiAnalysis 测试结论。                                                                                                               |
| `signal-20260910-semianalysis-btm-power`               | `company-oracle`：Project Jupiter 表后电力许可与方案调整案例的研究对象；可新增 `company-ge-vernova`：文中燃气轮机供给与订单研究对象；可新增 `company-siemens-energy`：文中燃气轮机供给与订单研究对象                           | [S17] “Project Jupiter: Grand Designs” 直接讨论 Oracle 案例；前文及 “secondary market” 部分具名 GEV、Siemens Energy。不能由报告推断它们承担全部 75GW 订单。                                                       |

最低集成集仅需新增 `company-oracle`、`company-coreweave`、`company-pjm-interconnection`、`company-cerebras` 四个组织，即可为全部 17 条建立至少一个有原文依据的组织关系。为充分展示资料中已具名主体，也可以同时登记下节两家中国企业；Vertiv、GE Vernova、Siemens Energy 为有直接依据的扩展项。

## 新实体登记建议

以下名称由事件原文支持。登记 `status: active` 不等于认可其全部商业主张；资源简介应介绍组织本身，不能重复“被本站关联”。

| 建议 ID                                       | 名称 / 类型                            | 简介方向与直接依据                                                                                           |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `company-oracle`                              | Oracle / company                       | 企业数据库、云计算和业务软件供应商；本轮关系证据为 [S04][S17] 的数据中心项目研究。                           |
| `company-coreweave`                           | CoreWeave / company                    | 面向 AI 工作负载提供 GPU 云基础设施的企业；本轮关系证据为 [S04][S12]。                                       |
| `company-pjm-interconnection`                 | PJM Interconnection / company          | 协调美国 13 个州及哥伦比亚特区全部或部分地区批发电力输送的区域输电组织；官方依据 [S21]。勿称为政府监管机构。 |
| `company-cerebras`                            | Cerebras Systems / company             | 研发晶圆级 AI 处理器及推理系统的企业；官方依据 [S22]。                                                       |
| `company-sichuan-shunxin-semiconductor`       | 四川顺芯半导体科技有限公司 / company   | 提供芯片封装与检测等半导体生产服务的企业；新华社实地采访 [S14]。                                             |
| `company-jiangsu-yangheyang-microelectronics` | 江苏扬贺扬微电子科技有限公司 / company | 从事芯片研发、设计与销售，产品用于消费电子、车载中控等领域；新华社实地采访 [S14]。                           |
| `company-vertiv`                              | Vertiv / company                       | 数据中心电力、制冷及模块化基础设施供应商；原研究 [S01]。                                                     |
| `company-ge-vernova`                          | GE Vernova / company                   | 能源技术与发电设备供应商；本次只关联原文中的燃气轮机供给研究 [S17]。                                         |
| `company-siemens-energy`                      | Siemens Energy / company               | 能源技术与发电设备供应商；本次只关联原文中的燃气轮机供给研究 [S17]。                                         |

## 可补的人物关系

以下两项来自同一原始采访 [S14]，不是凭企业高管身份推定参与：

| Signal                                           | 建议实体                               | 建议 `entity_roles`                          | 支持事实                                         |
| ------------------------------------------------ | -------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| `signal-20260902-china-ic-production-statistics` | `person-zhang-xiaohua`，张晓花，person | 四川顺芯半导体总经理、报道受访企业负责人     | [S14] 公司车间段落具名引用其生产目标和订单介绍。 |
| `signal-20260902-china-ic-production-statistics` | `person-chen-cheng`，陈程，person      | 江苏扬贺扬微电子运营总监、报道受访企业负责人 | [S14] 江苏企业段落具名引用其存储芯片出口介绍。   |

仍为空的三条逐一核查如下：

| Signal                                        | 结果         | 不补的原因                                                                                                                                                                              |
| --------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signal-20260804-aisi-agent-cyber-evaluation` | 保持人物为空 | [S18] 全文以 AISI、Security Team 或评估团队描述参与方，没有具名个人。技术报告附件入口可定位，但本轮网页工具读取失败；无法据此认定附件作者不存在。不得把 AISI 负责人自动写成事件负责人。 |
| `signal-20260820-nvidia-china-lpu-denial`     | 保持人物为空 | [S19] 当前否认声明仅署“发言人”，没有姓名。文末 Jensen Huang 是 5 月中国市场背景发言，与 8 月 20 日否认声明不同，不能标为本次声明人。                                                    |
| `signal-20260822-nvidia-server-price-report`  | 保持人物为空 | [S20] 未见具名事件发言人；图片人物与记者署名不足以确认调价参与者。                                                                                                                      |

## PORTS-Pike 既有信号补充

[事实] 2026-08-17 的 OpenAI 原始公告 [S23] 明确列出 SB Energy、NVIDIA 与美国能源部的合作角色。以下关系应补入既有 `signal-20260817-ports-pike-announcement`，不另建同一公告的新 Signal。

| 实体                      | 建议 `entity_roles`                                               | 支持事实与边界                                                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增 `company-sb-energy`  | PORTS-Pike 数据中心规划建设、持有与运营方及 OpenAI 长期租约合作方 | 公告说明 SB Energy 将在 20 年租约下建设、拥有和运营数据中心，逐步交付容量；这是未来安排，不能写成全部容量已经运营。其自身数据中心与电力基础设施业务见 [S24]。                                             |
| 新增 `institution-us-doe` | PORTS-Pike 原 Portsmouth 场地与现场基础设施合作机构               | 公告说明项目使用部分能源部控制的已修复土地，并与能源部合作利用现有现场供水系统；不把整个园区都称作能源部所有，也不推定其承担芯片采购。部门职责见 [S25]。                                                  |
| 已有 `company-nvidia`     | PORTS-Pike AI 算力基础设施合作方及初期建设融资支持方              | 公告说明园区规划使用 NVIDIA 算力基础设施，NVIDIA 将投资 SB Energy，并对初期 4.25 IT-GW 的土地、电力及厂房建设提供信用支持。投资与后续开发仍有基础设施、许可、环境审查和融资条件，不能视为已完成全部建设。 |

## 来源清单

除特别说明外，访问日期均为 2026-09-29。SemiAnalysis 是它自身研究结论的原始发布方；它关于其他公司的预测与评价不因此升级为那些公司的官方确认。

- S01：[The Wild Wild West Of LEGO Datacenters](https://newsletter.semianalysis.com/p/the-wild-wild-west-of-lego-datacenters)，2026-07-29，原研究，公开正文支持 AWS、Meta、Vertiv 等研究对象。
- S02：[Kimi K3: The Manos, The Mythos, The Legendos](https://newsletter.semianalysis.com/p/kimi-k3-the-manos-the-mythos-the)，2026-08-03，原研究，公开正文支持 Moonshot/Kimi 研发关系。
- S03：[Can AMD break the CUDA Moat? AMD Advancing AI 2026](https://newsletter.semianalysis.com/p/can-amd-break-the-cuda-moat-amd-advancing)，2026-07-25，原研究。
- S04：[Stop Saying Half of 2026 US Datacenter Capacity Is Canceled](https://newsletter.semianalysis.com/p/stop-saying-half-of-2026-us-datacenter)，2026-06-18，原研究；关系据具名项目案例建立，预测仍归作者。
- S05：[Ultra-High Interactivity on NVIDIA GPUs? - TileRT InferenceX](https://newsletter.semianalysis.com/p/ultra-high-interactivity-on-nvidia)，2026-08-10，原研究。
- S06：[Are AI Datacenters Increasing Electric Bills for American Households?](https://newsletter.semianalysis.com/p/are-ai-datacenters-increasing-electric)，2026-03-03，原研究。
- S07：[Cerebras's Next Generation CS-4: Fast Just Got Faster](https://newsletter.semianalysis.com/p/cerebrass-next-generation-cs-4-fast)，2026-08-19，原研究。
- S08：[US Grid Constraints: Towards 40GW+ of Behind-The-Meter Datacenter by 2028?](https://newsletter.semianalysis.com/p/us-grid-constraints-towards-40gw?triedRedirect=true)，2026-06-25，原研究。
- S09：[Are Open Models Catching Up?](https://newsletter.semianalysis.com/p/are-open-models-catching-up)，2026-08-21，原研究。
- S10：[AgentX - InferenceXv3: Does CUDA Moat Hold up in Agentic Inferencing?](https://newsletter.semianalysis.com/p/agentx-inferencexv3-does-cuda-moat)，2026-08-24，原研究。
- S11：[$12B of US ratepayers' money wasted on a modeling mistake and PJM wants to do it again](https://newsletter.semianalysis.com/p/12b-of-us-ratepayers-money-wasted)，2026-08-16，原研究。
- S12：[Most Neoclouds Suck At Security](https://newsletter.semianalysis.com/p/most-neoclouds-suck-at-security)，2026-08-30，原研究；只采用其具名测试对象，不对当前服务安全状况作普遍判断。
- S13：[Korea’s Trillion-Dollar Sovereign AI Investment: Nvidia Wins, Hynix Loses](https://newsletter.semianalysis.com/p/koreas-trillion-dollar-sovereign)，2026-09-01，原研究。
- S14：[市场最前沿丨产销两旺 我国集成电路产业迎来快速增长](https://www.news.cn/tech/20260902/4aa4d250a48847df83f12ab0e4901392/c.html)，2026-09-02，新华社原始采访；企业名称、受访人及职务直接见正文。
- S15：[路透：美中AI風險對話將於九月中旬舉行 美方由貝森特主談](https://udn.com/news/story/6809/9735837)，2026-09-05，联合报转述路透；白宫回应也只能标注“报道引述”。
- S16：[TPU Inference Externalization Full Steam Ahead - InferenceX](https://newsletter.semianalysis.com/p/tpu-inferencex-full-steam)，2026-09-07，原研究。
- S17：[What is So Hard About Behind-The-Meter Power For Datacenters? Part 1](https://newsletter.semianalysis.com/p/what-is-so-hard-about-behind-the)，2026-09-10，原研究。
- S18：[Incident Report: unsanctioned agent behaviour during cyber testing](https://www.aisi.gov.uk/blog/incident-report-unsanctioned-agent-behaviour-during-cyber-testing)，AISI 机构自述，区分 7 月 25–28 日行为期、7 月 28 日发现及后续披露；[技术报告附件入口](https://cdn.prod.website-files.com/663bd486c5e4c81588db7a1d/6a724858f7db25c81487016d_Security%20Incident%20INC-2026-07-28-01.pdf)本轮未能读取。
- S19：[傳年底小量出貨中國專用LPU　輝達否認：無相關規劃](https://money.udn.com/money/amp/story/123398/9704989)，2026-08-21 台湾刊载／圣克拉拉 8 月 20 日事件，中央社综合报道。
- S20：[Nvidia customers notified about AI-related price hikes above 15%](https://fortune.com/2026/08/22/nvidia-customers-ai-related-price-hikes-15-percent-vera-rubin-grace-blackwell-chips/)，2026-08-22，Fortune/Bloomberg 报道，仅用于核查有无具名参与者。
- S21：[PJM 官方 About PJM](https://www.pjm.com/about-pjm)，官方组织说明；本轮检索确认区域输电组织身份。
- S22：[Cerebras Unveils CS-4](https://investors.cerebras.ai/news-releases/news-release-details/cerebras-unveils-cs-4-30-times-faster-gpu-based-solutions)，2026-08-18，Cerebras 官方公告；确认产品归属，不采纳未独立复测的性能倍数。
- S23：[OpenAI joins PORTS-Pike project](https://openai.com/index/openai-joins-ports-pike-project/)，2026-08-17，OpenAI 原始公告；合作机构、场地及现场供水关系、20 年租约、建设安排和初期信用支持直接见正文。
- S24：[SB Energy 官方介绍](https://sbenergy.com/)，官方首页说明其美国数据中心与电力基础设施业务；用于资源自身简介，不把建设中数据中心写成已运营。
- S25：[U.S. Department of Energy — Mission](https://www.energy.gov/mission)，官方职责说明，涵盖能源、科学研究与核安全事务。

## 反面观点、风险与已知局限

- [推断] 将研究对象纳入相关组织能恢复有用的事件导航，但这些关系不能等同于新交易、合作或公司活动。若雷达资源热度将报告作者和研究对象都计入，含义是“在所收录信号中被关联的频次”，不一定是公司实际活动次数。
- [事实] 多篇研究涉及大量公司。本建议优先纳入围绕正文核心问题讨论的具名主体，并在角色中说明为什么关联；不把文末推荐文章、图片、水印和友情链接扩散成实体关系。
- [事实] 既有 Seed 没有按关系单独保存证据 URL 的字段，本文件需与数据改动一并提交，以保留增补依据；`source_url` 继续指向原 Signal 的来源。
- [事实] AISI 的技术 PDF 尚未成功读取。因此结论限于“本轮已读取材料未确认人物”，不能称为“完整报告证明没有人物”。
- [推断] 组织空缺可全部补齐，但剩余三条人物空缺需要具名证据或业务规则允许历史记录为空；补入著名高管会提高表面完整率，却降低数据可信度。
