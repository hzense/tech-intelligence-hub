/**
 * Reviewed, identity-specific introductions for the public resource directory.
 * A source must identify the person and directly support the stated role or work.
 * Do not infer current employment from an article byline or a co-mentioned Signal.
 * Reviewed 2026-09-27; additions reviewed 2026-09-29.
 * Mutable offices should be rechecked periodically.
 */
export const personProfiles: Readonly<Record<string, { introduction: string; sourceUrl: string }>> =
  {
    'person-asher-genoot': {
      introduction:
        'Asher Genoot 是 Hut 8 首席执行官兼董事，领导公司的能源与数据中心基础设施业务。',
      sourceUrl: 'https://www.hut8.com/investors/governance/',
    },
    'person-lip-bu-tan': {
      introduction: '陈立武是英特尔首席执行官，负责公司的产品、代工与人工智能战略。',
      sourceUrl: 'https://www.intel.com/content/www/us/en/corporate/executive-leadership.html',
    },
    'person-dave-zinsner': {
      introduction: 'Dave Zinsner 是英特尔执行副总裁兼首席财务官，负责财务管理。',
      sourceUrl: 'https://www.intel.com/content/www/us/en/corporate/executive-leadership.html',
    },
    'person-ted-lieu': {
      introduction:
        'Ted Lieu 是美国众议员，曾联合主持众议院跨党派人工智能工作组，并推动人工智能立法。',
      sourceUrl: 'https://lieu.house.gov/about/full-biography',
    },
    'person-nathaniel-moran': {
      introduction: 'Nathaniel Moran 是美国得克萨斯州第一国会选区众议员，曾任史密斯县县法官。',
      sourceUrl: 'https://moran.house.gov/about/',
    },
    'person-jinman-han': {
      introduction: 'Jinman Han 是三星电子晶圆代工业务负责人，参与推进先进制程与存储器合作。',
      sourceUrl:
        'https://news.samsung.com/global/samsung-electronics-and-broadcom-expand-strategic-collaboration-across-memory-and-foundry-technologies',
    },
    'person-hock-tan': {
      introduction: '陈福阳是博通总裁兼首席执行官，领导半导体及基础设施软件业务。',
      sourceUrl:
        'https://news.samsung.com/global/samsung-electronics-and-broadcom-expand-strategic-collaboration-across-memory-and-foundry-technologies',
    },
    'person-young-hyun-jun': {
      introduction:
        '全永铉是三星电子 Device Solutions 事业部副会长兼首席执行官，负责其半导体业务。',
      sourceUrl:
        'https://news.samsung.com/global/samsung-electronics-and-broadcom-expand-strategic-collaboration-across-memory-and-foundry-technologies',
    },
    'person-charlie-kawwas': {
      introduction: 'Charlie Kawwas 是博通半导体解决方案事业部总裁，推进人工智能基础设施芯片合作。',
      sourceUrl:
        'https://news.samsung.com/global/samsung-electronics-and-broadcom-expand-strategic-collaboration-across-memory-and-foundry-technologies',
    },
    'person-satya-nadella': {
      introduction: 'Satya Nadella 是微软董事长兼首席执行官，领导其云计算与人工智能业务。',
      sourceUrl: 'https://news.microsoft.com/source/leadership',
    },
    'person-amy-hood': {
      introduction: 'Amy Hood 是微软执行副总裁兼首席财务官，负责公司的财务战略与管理。',
      sourceUrl: 'https://news.microsoft.com/source/leadership',
    },
    'person-andy-jassy': {
      introduction: 'Andy Jassy 是亚马逊总裁兼首席执行官，曾创建并领导 Amazon Web Services。',
      sourceUrl:
        'https://ir.aboutamazon.com/officers-and-directors/person-details/default.aspx?ItemId=be0a9875-4456-4f84-b4d9-ec2e4b97d1d8',
    },
    'person-lisa-su': {
      introduction: '苏姿丰是 AMD 董事长兼首席执行官，领导其高性能计算与人工智能芯片业务。',
      sourceUrl: 'https://www.amd.com/en/corporate/leadership.html',
    },
    'person-jean-hu': {
      introduction: 'Jean Hu 是 AMD 执行副总裁、首席财务官兼财务主管。',
      sourceUrl: 'https://www.amd.com/en/corporate/leadership.html',
    },
    'person-vamsi-boppana': {
      introduction: 'Vamsi Boppana 是 AMD 人工智能业务高级副总裁，负责相关技术与产品发展。',
      sourceUrl: 'https://www.amd.com/en/corporate/leadership.html',
    },
    'person-ljubisa-bajic': {
      introduction: 'Ljubisa Bajic 是人工智能推理芯片公司 Taalas 的联合创始人兼首席执行官。',
      sourceUrl:
        'https://ir.amd.com/news-events/press-releases/detail/1296/amd-acquires-taalas-to-advance-compute-solutions-for-rapidly-growing-ai-inference-market',
    },
    'person-tekedra-mawakana': {
      introduction: 'Tekedra Mawakana 是 Waymo 联席首席执行官，负责自动驾驶技术的商业化与推广。',
      sourceUrl: 'https://waymo.com/company/tekedra-mawakana/',
    },
    'person-kwak-noh-jung': {
      introduction: 'Kwak Noh-Jung 是 SK 海力士总裁兼首席执行官，领导其存储器及先进封装业务。',
      sourceUrl: 'https://news.skhynix.com/en/groundbreaking-ceremony-in-indiana/',
    },
    'person-cristiano-amon': {
      introduction: 'Cristiano Amon 是高通总裁兼首席执行官，推动无线通信与端侧人工智能业务。',
      sourceUrl: 'https://www.qualcomm.com/edgeofpossible',
    },
    'person-prasad-kalyanaraman': {
      introduction:
        'Prasad Kalyanaraman 是 AWS 基础设施服务副总裁，负责支撑云服务的数据中心基础设施。',
      sourceUrl: 'https://www.aboutamazon.com/news/aws/aws-infrastructure-generative-ai',
    },
    'person-andrew-bailey': {
      introduction: 'Andrew Bailey 是金融稳定理事会主席，关注前沿人工智能对金融体系的网络风险。',
      sourceUrl:
        'https://www.fsb.org/2026/08/fsb-chair-warns-of-risks-arising-from-frontier-artificial-intelligence-ai-models/',
    },
    'person-jensen-huang': {
      introduction: '黄仁勋是 NVIDIA 创始人、总裁兼首席执行官，自 1993 年起领导公司发展。',
      sourceUrl:
        'https://www.nvidia.com/en-eu/about-nvidia/governance/management-team/jensen-huang/',
    },

    // Publication credits demonstrate authorship; they do not establish employment.
    'person-aishwarya-mahesh': {
      introduction:
        'Aishwarya Mahesh 是研究人工智能数据中心与美国电价关系的 SemiAnalysis 报告署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/are-ai-datacenters-increasing-electric',
    },
    'person-jeremie-eliahou-ontiveros': {
      introduction:
        'Jeremie Eliahou Ontiveros 是数据中心电力与建设研究作者，参与 SemiAnalysis 多篇基础设施报告。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/us-grid-constraints-towards-40gw',
    },
    'person-ajey-pandey': {
      introduction: 'Ajey Pandey 是研究人工智能数据中心电力成本的 SemiAnalysis 报告署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/are-ai-datacenters-increasing-electric',
    },
    'person-reyk-knuhtsen': {
      introduction: 'Reyk Knuhtsen 是数据中心容量与电力市场研究作者，参与 SemiAnalysis 相关报告。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/stop-saying-half-of-2026-us-datacenter',
    },
    'person-maya-barkin': {
      introduction: 'Maya Barkin 是 SemiAnalysis 数据中心容量延期研究的署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/stop-saying-half-of-2026-us-datacenter',
    },
    'person-sebastian-orejas': {
      introduction: 'Sebastian Orejas 是 SemiAnalysis 美国电网及数据中心表后供电研究的署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/us-grid-constraints-towards-40gw',
    },
    'person-nicolas-bontigui': {
      introduction: 'Nicolas Bontigui 是 SemiAnalysis 模块化数据中心研究的署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/the-wild-wild-west-of-lego-datacenters',
    },
    'person-eric-junqi-wen': {
      introduction: 'Eric（Junqi）Wen 是 SemiAnalysis 模块化数据中心研究的署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/the-wild-wild-west-of-lego-datacenters',
    },
    'person-kimbo-chen': {
      introduction: 'Kimbo Chen 是研究 Kimi K3 模型架构和推理系统的 SemiAnalysis 文章署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/kimi-k3-the-manos-the-mythos-the',
    },
    'person-shubham-choudhari': {
      introduction:
        'Shubham Choudhari 是研究 Kimi K3 模型架构和推理系统的 SemiAnalysis 文章署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/kimi-k3-the-manos-the-mythos-the',
    },
    'person-bryan-shan': {
      introduction:
        'Bryan Shan 是人工智能推理芯片与模型系统分析作者，参与 SemiAnalysis 的 Kimi K3 和芯片研究。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/kimi-k3-the-manos-the-mythos-the',
    },
    'person-daniel-nishball': {
      introduction:
        'Daniel Nishball 是人工智能推理基础设施研究作者，参与 SemiAnalysis 的 GPU 软件分析。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/ultra-high-interactivity-on-nvidia',
    },
    'person-myron-xie': {
      introduction:
        'Myron Xie 是人工智能芯片与推理系统研究作者，参与 SemiAnalysis 的 Cerebras CS-4 分析。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/cerebrass-next-generation-cs-4-fast',
    },
    'person-max-kan': {
      introduction: 'Max Kan 是开放模型与云业务研究作者，参与 SemiAnalysis 的模型趋势分析。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/are-open-models-catching-up',
    },
    'person-joey-brookhart': {
      introduction: 'Joey Brookhart 是 SemiAnalysis 关于 Google Cloud 和模型业务的文章署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/gemini-is-cooked-but-gcp-is-cooking',
    },
    'person-doug-olaughlin': {
      introduction: 'Doug O’Laughlin 是 SemiAnalysis 总裁，参与半导体与人工智能产业研究。',
      sourceUrl: 'https://semianalysis.com/semianalysis-events/',
    },
    'person-dylan-patel': {
      introduction: 'Dylan Patel 是 SemiAnalysis 创始人，研究半导体供应链与人工智能基础设施。',
      sourceUrl: 'https://semianalysis.com/semianalysis-events/',
    },
    'person-cam-quilici': {
      introduction: 'Cam Quilici 是 GPU 推理性能研究作者，参与 SemiAnalysis 的 TileRT 分析。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/ultra-high-interactivity-on-nvidia',
    },
    'person-robert-boswall': {
      introduction:
        'Robert Boswall 是电力市场与数据中心建设研究作者，参与 SemiAnalysis 的 PJM 容量市场报告。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/12b-of-us-ratepayers-money-wasted',
    },
    'person-wega-chu': {
      introduction: 'Wega Chu 是人工智能芯片研究作者，参与 SemiAnalysis 的 Cerebras CS-4 分析。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/cerebrass-next-generation-cs-4-fast',
    },
    'person-evan-cloutier': {
      introduction:
        'Evan Cloutier 是开放模型能力趋势研究作者，参与 SemiAnalysis 对开放与闭源模型的比较。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/are-open-models-catching-up',
    },
    'person-jordan-nanos': {
      introduction:
        'Jordan Nanos 是开放模型与 AI 云安全研究作者，参与 SemiAnalysis 的 Neocloud 安全分析。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/most-neoclouds-suck-at-security',
    },
    'person-alec-ibarra': {
      introduction:
        'Alec Ibarra 是 AI 推理基础设施研究作者，参与 SemiAnalysis 的 TPU InferenceX 分析。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/tpu-inferencex-full-steam',
    },
    'person-sam-harshe': {
      introduction: 'Sam Harshe 是 SemiAnalysis 云计算服务安全研究的署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/most-neoclouds-suck-at-security',
    },
    'person-pratt-bhatt': {
      introduction: 'Pratt Bhatt 是 SemiAnalysis 云计算服务安全研究的署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/most-neoclouds-suck-at-security',
    },
    'person-ray-wang': {
      introduction: 'Ray Wang 是 SemiAnalysis 韩国主权人工智能投资研究的署名作者。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/koreas-trillion-dollar-sovereign',
    },
    'person-ellie-holbrook': {
      introduction: 'Ellie Holbrook 是数据中心表后电力建设研究作者，参与 SemiAnalysis 的相关报告。',
      sourceUrl: 'https://newsletter.semianalysis.com/p/what-is-so-hard-about-behind-the',
    },
    'person-mark-zuckerberg': {
      introduction: 'Mark Zuckerberg 是 Meta 创始人兼首席执行官，推动社交平台与人工智能产品发展。',
      sourceUrl:
        'https://about.fb.com/news/2026/01/dina-powell-mccormick-joins-meta-as-president-and-vice-chairman/',
    },
    'person-sundar-pichai': {
      introduction:
        'Sundar Pichai 是 Alphabet 与 Google 首席执行官，领导搜索、云计算和人工智能产品。',
      sourceUrl:
        'https://abc.xyz/investor/events/event-details/2026/2025-Q4-Earnings-Call-2026-Dr_C033hS6/default.aspx',
    },
    'person-tom-brown': {
      introduction: 'Tom Brown 是 Anthropic 联合创始人兼首席算力官，领导算力资源获取与扩展工作。',
      sourceUrl: 'https://www.anthropic.com/company/leadership',
    },
    'person-chey-tae-won': {
      introduction: '崔泰源是 SK 集团董事长，推动集团在存储器与人工智能基础设施领域合作。',
      sourceUrl: 'https://news.skhynix.com/en/gtc-2026-ai-partnership-3/',
    },
    'person-sid-sheth': {
      introduction: 'Sid Sheth 是 d-Matrix 联合创始人兼首席执行官，开发面向人工智能推理的加速器。',
      sourceUrl: 'https://blogs.nvidia.com/blog/d-matrix-nvlink-fusion/',
    },
    'person-deepak-pathak': {
      introduction: 'Deepak Pathak 是 Skild AI 联合创始人兼首席执行官，研究通用机器人基础模型。',
      sourceUrl: 'https://skild.ai/blogs/skild-crosses-100m-arr',
    },
    'person-rick-tsai': {
      introduction: '蔡力行是联发科副董事长兼首席执行官，领导移动通信与人工智能芯片业务。',
      sourceUrl: 'https://www.mediatek.com/investor-relations/corporate-governance',
    },
    'person-raj-mirpuri': {
      introduction:
        'Raj Mirpuri 是 NVIDIA 全球人工智能云与基础设施生态系统副总裁，推进 AI 数据中心合作。',
      sourceUrl:
        'https://nvidianews.nvidia.com/news/nvidia-expands-ai-infrastructure-capacity-in-partnership-with-australias-data-center-ecosystem',
    },
    'person-oliver-curtis': {
      introduction:
        'Oliver Curtis 是 Firmus 联合创始人兼联席首席执行官，建设面向人工智能的澳大利亚数据中心。',
      sourceUrl:
        'https://nvidianews.nvidia.com/news/nvidia-expands-ai-infrastructure-capacity-in-partnership-with-australias-data-center-ecosystem',
    },
    'person-james-manning': {
      introduction:
        'James Manning 是 Sharon AI 联合创始人兼首席执行官，推进人工智能云算力基础设施。',
      sourceUrl:
        'https://nvidianews.nvidia.com/news/nvidia-expands-ai-infrastructure-capacity-in-partnership-with-australias-data-center-ecosystem',
    },
    'person-daniel-roberts': {
      introduction:
        'Daniel Roberts 是 IREN 联合创始人兼联席首席执行官，建设大规模人工智能数据中心。',
      sourceUrl:
        'https://nvidianews.nvidia.com/news/nvidia-expands-ai-infrastructure-capacity-in-partnership-with-australias-data-center-ecosystem',
    },
    'person-michael-reid': {
      introduction: 'Michael Reid 是 Megaport 首席执行官，推动全球互联网络与人工智能算力服务。',
      sourceUrl:
        'https://nvidianews.nvidia.com/news/nvidia-expands-ai-infrastructure-capacity-in-partnership-with-australias-data-center-ecosystem',
    },
    'person-marcel-zalloua': {
      introduction:
        'Marcel Zalloua 是 ResetData 联席首席执行官，建设澳大利亚本地人工智能云基础设施。',
      sourceUrl:
        'https://nvidianews.nvidia.com/news/nvidia-expands-ai-infrastructure-capacity-in-partnership-with-australias-data-center-ecosystem',
    },
    'person-greg-boorer': {
      introduction:
        'Greg Boorer 是 CDC 创始人兼首席执行官，经营澳大利亚及新西兰的数据中心基础设施。',
      sourceUrl:
        'https://nvidianews.nvidia.com/news/nvidia-expands-ai-infrastructure-capacity-in-partnership-with-australias-data-center-ecosystem',
    },
    'person-clem-delangue': {
      introduction:
        'Clem Delangue 是 Hugging Face 联合创始人兼首席执行官，推动开放机器学习模型与社区平台。',
      sourceUrl: 'https://huggingface.co/blog/sentence-transformers-joins-hf',
    },
    'person-jakub-pachocki': {
      introduction: 'Jakub Pachocki 是 OpenAI 首席科学家，曾领导 GPT-4 等关键研究项目。',
      sourceUrl: 'https://openai.com/index/jakub-pachocki-announced-as-chief-scientist/',
    },
    'person-jager-mcconnell': {
      introduction: 'Jager McConnell 是 Crunchbase 首席执行官，推动私营公司及融资数据服务。',
      sourceUrl: 'https://openai.com/index/introducing-chatgpt-financial-services/',
    },
    'person-thomas-li': {
      introduction: 'Thomas Li 是 Daloopa 首席执行官，提供面向投资分析的结构化财务数据。',
      sourceUrl: 'https://openai.com/index/introducing-chatgpt-financial-services/',
    },
    'person-craig-falls': {
      introduction:
        'Craig Falls 是 Jane Street 量化研究负责人，参与评估人工智能模型的交易与编程能力。',
      sourceUrl: 'https://www.anthropic.com/claude-fable-and-mythos-5-1',
    },
    'person-walden-yan': {
      introduction: 'Walden Yan 是 Cognition 联合创始人兼首席产品官，参与智能编程产品研发。',
      sourceUrl: 'https://www.anthropic.com/claude-fable-and-mythos-5-1',
    },
    'person-silas-alberti': {
      introduction: 'Silas Alberti 是 Cognition 研究高级副总裁，参与智能编程系统的模型评测。',
      sourceUrl: 'https://openai.com/index/gpt-6-astra/',
    },
    'person-alex-mashrabov': {
      introduction:
        'Alex Mashrabov 是 Higgsfield AI 联合创始人兼首席执行官，开发人工智能创作工具。',
      sourceUrl: 'https://openai.com/index/gpt-6-astra/',
    },
    'person-david-berry': {
      introduction:
        'David Berry 是 Cloverleaf Infrastructure 联合创始人兼首席执行官，开发数据中心电力与场地基础设施。',
      sourceUrl:
        'https://www.cloverleafinfra.com/newsroom/cloverleaf-infrastructure-forms-strategic-partnership-with-nvidia-to-accelerate-data-center-infrastructure-development',
    },
    'person-nico-caprez': {
      introduction: 'Nico Caprez 是 NVIDIA 全球人工智能基础设施增长副总裁，推动数据中心合作。',
      sourceUrl:
        'https://www.cloverleafinfra.com/newsroom/cloverleaf-infrastructure-forms-strategic-partnership-with-nvidia-to-accelerate-data-center-infrastructure-development',
    },
    'person-lei-jun': {
      introduction: '雷军是小米集团创始人、董事长兼首席执行官，推动智能手机、汽车及生态业务发展。',
      sourceUrl: 'https://ir.mi.com/zh-hans/corporate-information/board-of-directors',
    },
    'person-michael-kratsios': {
      introduction: 'Michael Kratsios 是美国白宫科学技术政策办公室主任，负责科技政策议程。',
      sourceUrl: 'https://www.whitehouse.gov/science/',
    },
    'person-scott-bessent': {
      introduction: 'Scott Bessent 是美国财政部长，负责财政部的经济与金融政策。',
      sourceUrl: 'https://home.treasury.gov/about/general-information/officials',
    },
    'person-xiang-ligang': {
      introduction: '项立刚是中国通信产业观察者，长期撰写通信技术与产业发展评论。',
      sourceUrl: 'https://www.guancha.cn/xiangligang/2020_03_15_541703.shtml',
    },
    'person-li-chao': {
      introduction: '李超是中国国家发展改革委新闻发言人，参与宏观经济和产业政策的信息发布。',
      sourceUrl: 'https://www.ndrc.gov.cn/xwdt/wszb/202605xwfbh/wzsl/202605/t20260522_1405380.html',
    },
    'person-liu-liehong': {
      introduction: '刘烈宏是中国国家数据局局长，负责数据基础制度和数字经济发展工作。',
      sourceUrl: 'https://www.nda.gov.cn/sjj/jgsz/jld/llh/list/index_pc_1.html',
    },
    'person-wang-yanhui': {
      introduction: '王艳辉是集微网创始人，长期报道和研究半导体产业。',
      sourceUrl: 'https://new.laoyaoba.com/n/683317',
    },
    'person-jacob-klein': {
      introduction: 'Jacob Klein 从事人工智能威胁情报研究，参与分析针对模型和服务的攻击活动。',
      sourceUrl: 'https://www.anthropic.com/research/attack-navigator',
    },
    'person-huang-zhenxin': {
      introduction: '黄震昕是月之暗面企业业务负责人，参与 Kimi 面向企业客户的业务拓展。',
      sourceUrl: 'https://api3.cls.cn/share/article/2432968?app=&os=ios&sv=842',
    },
    'person-song-hyun-jong': {
      introduction: '宋贤钟是 SK 海力士 Corporate Center 总裁，曾因半导体产业贡献获韩国政府表彰。',
      sourceUrl: 'https://news.skhynix.com/en/award-on-commerce-and-industry-day-2026/',
    },
    'person-karsten-wildberger': {
      introduction: 'Karsten Wildberger 是德国联邦数字化与国家现代化部长，负责数字政府相关政策。',
      sourceUrl:
        'https://www.bundesregierung.de/breg-de/service/newsletter-und-abos/bulletin/bmds-haushaltsgesetz-2027-2451914',
    },
    'person-klaus-mueller': {
      introduction: 'Klaus Müller 是德国联邦网络局局长，负责电信、能源和数字基础设施监管。',
      sourceUrl:
        'https://www.bundesnetzagentur.de/EN/General/Bundesnetzagentur/Presidents/start.html',
    },
    'person-henna-virkkunen': {
      introduction: 'Henna Virkkunen 是欧盟委员会负责技术主权、安全与民主事务的执行副主席。',
      sourceUrl:
        'https://commission.europa.eu/about/organisation/college-commissioners/henna-virkkunen_en',
    },
    'person-sam-altman': {
      introduction: 'Sam Altman 是 OpenAI 首席执行官，推动人工智能模型、产品及基础设施发展。',
      sourceUrl: 'https://openai.com/index/openai-broadcom-jalapeno-inference-chip/',
    },
    'person-richard-ho': {
      introduction: 'Richard Ho 领导 OpenAI 硬件项目，参与自研推理芯片设计。',
      sourceUrl: 'https://openai.com/index/openai-broadcom-jalapeno-inference-chip/',
    },
    'person-elon-musk': {
      introduction:
        'Elon Musk 是 Tesla 首席执行官及 SpaceX 领导者，涉足电动车、航天与人工智能业务。',
      sourceUrl: 'https://ir.tesla.com/corporate/elon-musk',
    },
    'person-amelia-glaese': {
      introduction:
        'Amelia Glaese 是人工智能研究者，参与 OpenAI 的 BrowseComp 智能体浏览能力评测研究。',
      sourceUrl: 'https://cdn.openai.com/pdf/5e10f4ab-d6f7-442e-9508-59515c65e35d/browsecomp.pdf',
    },
    'person-fouad-matin': {
      introduction:
        'Fouad Matin 是软件工程师和产品设计师，其个人网站称目前在 OpenAI 从事安全工作。',
      sourceUrl: 'https://fouad.org/',
    },
    'person-zhao-lidong': {
      introduction: '赵立东是燧原科技董事长，带领公司研发人工智能计算芯片。',
      sourceUrl:
        'https://static.sse.com.cn/stock/disclosure/announcement/c/202604/002175_20260416_BH8W.pdf',
    },
    'person-zhang-yalin': {
      introduction: '张亚林是燧原科技总经理，参与人工智能计算芯片业务管理。',
      sourceUrl:
        'https://static.sse.com.cn/stock/disclosure/announcement/c/202604/002175_20260416_BH8W.pdf',
    },
    'person-paul-triolo': {
      introduction: 'Paul Triolo 是 DGA Group 技术政策负责人，研究全球科技政策与半导体产业。',
      sourceUrl:
        'https://dgagroup.com/wp-content/uploads/2026/01/2026-AI-Decrypted-Report-DGA-Group.pdf',
    },
    'person-sebastien-bubeck': {
      introduction: 'Sébastien Bubeck 是人工智能研究者，研究大语言模型推理与数学能力。',
      sourceUrl: 'https://www.pacm.princeton.edu/events/recent-advances-llms-mathematics',
    },
    'person-zhang-xiaohua': {
      introduction: '张晓花担任四川顺芯半导体科技有限公司总经理。',
      sourceUrl: 'https://www.news.cn/tech/20260902/4aa4d250a48847df83f12ab0e4901392/c.html',
    },
    'person-chen-cheng': {
      introduction: '陈程担任江苏扬贺扬微电子科技有限公司运营总监。',
      sourceUrl: 'https://www.news.cn/tech/20260902/4aa4d250a48847df83f12ab0e4901392/c.html',
    },
  };
