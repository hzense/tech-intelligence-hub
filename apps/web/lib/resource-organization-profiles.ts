/**
 * Curated, entity-specific introductions. These describe the organization
 * itself, not the number or topic of its relationships in this site.
 * `sourceUrl` points to the organization's own site or a primary filing.
 * Reviewed on 2026-09-27; revisit time-sensitive business descriptions.
 */
export const organizationProfiles: Readonly<
  Record<string, { introduction: string; sourceUrl: string }>
> = {
  'company-openai': {
    introduction: 'OpenAI 是开展人工智能研究与产品部署的机构，致力于开发对人类有益的通用人工智能。',
    sourceUrl: 'https://openai.com/about/',
  },
  'company-anthropic': {
    introduction: 'Anthropic 是人工智能安全与研究公司，开发可理解、可引导且可靠的 AI 系统。',
    sourceUrl: 'https://www.anthropic.com/company',
  },
  'company-meta': {
    introduction:
      'Meta 经营 Facebook、Instagram 和 WhatsApp 等社交产品，并研发混合现实与人工智能技术。',
    sourceUrl: 'https://www.meta.com/about/company-info/',
  },
  'company-google': {
    introduction: 'Google 提供搜索、Android、云计算与人工智能等互联网产品和技术服务。',
    sourceUrl: 'https://about.google/products/',
  },
  'company-nvidia': {
    introduction:
      'NVIDIA 开发 GPU、网络设备与软件平台，为图形计算、数据中心和人工智能提供加速计算技术。',
    sourceUrl: 'https://www.nvidia.com/en-us/data-center/',
  },
  'company-apple': {
    introduction: 'Apple 设计和销售 iPhone、Mac、iPad 等设备，并提供操作系统、应用与数字服务。',
    sourceUrl: 'https://www.apple.com/business/',
  },
  'company-figure-ai': {
    introduction: 'Figure 是研发通用人形机器人的人工智能机器人公司，面向工作和家庭场景。',
    sourceUrl: 'https://www.figure.ai/company',
  },
  'company-boston-dynamics': {
    introduction:
      'Boston Dynamics 研发和部署具备移动、操作与感知能力的机器人，服务工业及仓储等场景。',
    sourceUrl: 'https://bostondynamics.com/about/',
  },
  'company-d-matrix': {
    introduction: 'd-Matrix 开发面向生成式人工智能推理的计算芯片和软硬件平台。',
    sourceUrl: 'https://www.d-matrix.ai/about/',
  },
  'company-skild-ai': {
    introduction: 'Skild AI 研发可跨机器人形态和任务使用的机器人基础模型。',
    sourceUrl: 'https://www.skild.ai/blogs/building-the-general-purpose-robotic-brain',
  },
  'company-hut8': {
    introduction: 'Hut 8 开发和运营面向高能耗计算的电力及数据中心基础设施。',
    sourceUrl: 'https://www.hut8.com/digital-infrastructure',
  },
  'company-intel': {
    introduction: 'Intel 设计和制造处理器、加速器及相关软件，并经营半导体代工业务。',
    sourceUrl: 'https://www.intel.com/content/www/us/en/company-overview/company-overview.html',
  },
  'company-samsung-electronics': {
    introduction:
      '三星电子经营消费电子、移动设备与半导体业务，产品包括智能手机、存储芯片及晶圆代工服务。',
    sourceUrl: 'https://news.samsung.com/global/fast-facts',
  },
  'company-broadcom': {
    introduction:
      'Broadcom 提供半导体和基础设施软件，覆盖网络连接、数据中心、存储及企业软件等领域。',
    sourceUrl: 'https://www.broadcom.com/company/about-us',
  },
  'company-sk-hynix': {
    introduction: 'SK hynix 是存储半导体企业，生产 DRAM、NAND 闪存及高带宽存储器等产品。',
    sourceUrl: 'https://news.skhynix.com/en/5-things-about-skhynix/',
  },
  'company-microsoft': {
    introduction:
      'Microsoft 开发 Windows、Microsoft 365、Azure 等软件与云服务，并提供人工智能产品。',
    sourceUrl: 'https://www.microsoft.com/en-us/about',
  },
  'company-amazon': {
    introduction: 'Amazon 经营电商、物流和 AWS 云服务，并开发人工智能、设备与数字娱乐业务。',
    sourceUrl: 'https://www.aboutamazon.com/what-we-do',
  },
  'company-amd': {
    introduction:
      'AMD 研发高性能处理器、图形芯片及自适应计算产品，服务数据中心、个人电脑与嵌入式市场。',
    sourceUrl: 'https://www.amd.com/en/corporate.html',
  },
  'company-taalas': {
    introduction: 'Taalas 开发将人工智能模型转化为专用硅芯片的计算平台。',
    sourceUrl: 'https://taalas.com/the-path-to-ubiquitous-ai/',
  },
  'company-waymo': {
    introduction:
      'Waymo 是 Alphabet 旗下自动驾驶技术公司，开发自动驾驶系统并运营无人驾驶出行服务。',
    sourceUrl: 'https://waymo.com/about/',
  },
  'company-qualcomm': {
    introduction:
      'Qualcomm 研发无线通信技术、处理器和连接平台，并通过芯片产品与技术授权服务设备厂商。',
    sourceUrl: 'https://www.qualcomm.com/company',
  },
  'company-moonshot-ai': {
    introduction: '月之暗面（Moonshot AI）是开发 Kimi 人工智能助手与大模型的公司。',
    sourceUrl: 'https://www.kimi.ai/help/getting-started/overview',
  },
  'company-cxmt': {
    introduction: '长鑫存储（CXMT）生产用于手机、个人电脑和服务器等设备的 DRAM 存储芯片。',
    sourceUrl: 'https://www.cxmt.com/en/about.html',
  },
  'company-semianalysis': {
    introduction: 'SemiAnalysis 是独立研究机构，分析半导体、人工智能及其供应链和基础设施。',
    sourceUrl: 'https://semianalysis.com/about/',
  },
  'company-alphabet': {
    introduction:
      'Alphabet 是 Google 及 Waymo 等业务的控股公司，经营互联网服务、云计算与其他技术项目。',
    sourceUrl: 'https://abc.xyz/investor/faqs-and-general-information/',
  },
  'company-sk-group': {
    introduction: 'SK Group 是韩国企业集团，业务覆盖半导体、能源、通信和生命科学等领域。',
    sourceUrl: 'https://sk.com/en/about/about.jsp',
  },
  'company-sk-telecom': {
    introduction: 'SK Telecom 是韩国通信运营商，提供移动通信服务并发展人工智能及数据中心业务。',
    sourceUrl: 'https://news.sktelecom.com/en/467',
  },
  'company-mediatek': {
    introduction: 'MediaTek 是无晶圆厂半导体设计公司，研发移动设备、联网设备与物联网系统芯片。',
    sourceUrl: 'https://www.mediatek.com/company/discover',
  },
  'company-hugging-face': {
    introduction: 'Hugging Face 运营开放的人工智能模型与数据集社区，并开发机器学习工具。',
    sourceUrl: 'https://huggingface.co/docs/hub/index',
  },
  'company-cloverleaf-infrastructure': {
    introduction:
      'Cloverleaf Infrastructure 与电力企业合作，开发具备能源供应条件的数据中心建设用地。',
    sourceUrl: 'https://www.cloverleafinfra.com/about-us',
  },
  'company-firmus': {
    introduction: 'Firmus 开发、建设和运营面向人工智能工作负载的数据中心与计算基础设施。',
    sourceUrl: 'https://firmus.co/about',
  },
  'company-sharon-ai': {
    introduction: 'Sharon AI 提供 GPU 云计算与人工智能基础设施，面向模型训练和企业工作负载。',
    sourceUrl: 'https://sharonai.com/ai-cloud/',
  },
  'company-iren': {
    introduction: 'IREN 开发数据中心并提供 GPU 云服务，承载人工智能及高性能计算工作负载。',
    sourceUrl: 'https://www.iren.com/',
  },
  'company-megaport': {
    introduction: 'Megaport 提供按需网络连接服务，连接企业网络、数据中心和云平台。',
    sourceUrl: 'https://www.megaport.com/about-megaport/who-is-megaport/',
  },
  'company-resetdata': {
    introduction: 'ResetData 建设面向澳大利亚企业与政府的本地化数据中心及计算基础设施。',
    sourceUrl: 'https://resetdata.com.au/about',
  },
  'company-cdc': {
    introduction: 'CDC Data Centres 在澳大利亚和新西兰开发、持有并运营高安全性的大型数据中心。',
    sourceUrl: 'https://cdc.com/about-us/',
  },
  'company-nextdc': {
    introduction: 'NEXTDC 是澳大利亚数据中心运营商，提供机柜托管、网络互联与基础设施管理服务。',
    sourceUrl: 'https://www.nextdc.com/about-us',
  },
  'company-airtrunk': {
    introduction:
      'AirTrunk 在亚太和中东开发、运营超大规模数据中心，为云服务和大型企业提供基础设施。',
    sourceUrl: 'https://airtrunk.com/about-airtrunk/',
  },
  'company-enflame': {
    introduction: '燧原科技研发和销售云端人工智能芯片及相关算力产品。',
    sourceUrl:
      'https://static.sse.com.cn/stock/disclosure/announcement/c/202604/002175_20260416_BH8W.pdf',
  },
  'company-united-daily-news': {
    introduction: '《联合报》是台湾新闻媒体，提供报纸与数字平台上的时事、社会和财经报道。',
    sourceUrl: 'https://www.udngroup.com/journalism',
  },
  'institution-european-commission': {
    introduction: '欧盟委员会是欧盟行政机构，负责提出法律和政策、监督执行并管理欧盟预算。',
    sourceUrl: 'https://commission.europa.eu/about/role_en',
  },
  'institution-white-house': {
    introduction: '白宫是美国总统及其行政团队的办公和政策发布中心。',
    sourceUrl: 'https://www.whitehouse.gov/government/executive-branch/',
  },
  'institution-fsb': {
    introduction: '金融稳定理事会是监测全球金融体系风险并提出政策建议的国际协调机构。',
    sourceUrl: 'https://www.fsb.org/about/',
  },
  'institution-fcc': {
    introduction: '美国联邦通信委员会是监管跨州及国际无线、电信和广播通信的联邦机构。',
    sourceUrl: 'https://docs.fcc.gov/public/attachments/DOC-337724A1.pdf',
  },
  'institution-china-mofcom': {
    introduction: '中国商务部主管国内外贸易、国际经济合作和外商投资等商务领域政策。',
    sourceUrl:
      'https://www.mofcom.gov.cn/zfxxgk/fdzdgknr/zyzz/art/2023/art_402751780fe245989af6c3da48fdd9bf.html',
  },
  'institution-german-government': {
    introduction: '德国联邦政府由联邦总理和联邦部长组成，负责联邦层面的行政事务。',
    sourceUrl:
      'https://www.bundesregierung.de/breg-en/federal-government/structure-and-tasks-470508',
  },
  'institution-china-politburo': {
    introduction:
      '中共中央政治局是中国共产党中央领导机构，在中央委员会全体会议闭会期间行使其职权。',
    sourceUrl: 'https://www.12371.cn/special/zggcdzc/zggcdzcqw/',
  },
  'institution-china-state-council': {
    introduction: '中华人民共和国国务院是最高国家行政机关，负责国家行政工作。',
    sourceUrl:
      'https://english.www.gov.cn/archive/chinaabc/201911/22/content_WS5ed77233c6d0b3f0e9499854.html',
  },
  'institution-china-ndrc': {
    introduction: '国家发展改革委负责拟订和实施国民经济与社会发展战略、规划及宏观调控政策。',
    sourceUrl: 'https://www.ndrc.gov.cn/fzggw/bnpz/201906/t20190613_948567.html',
  },
  'institution-china-nda': {
    introduction: '国家数据局统筹数字中国建设、数据基础制度和数据资源开发利用。',
    sourceUrl: 'https://www.nda.gov.cn/sjj/jgsz/gjsjj/1212/20241212111533730775955_pc.html',
  },
  'institution-us-house': {
    introduction: '美国众议院是美国国会两院之一，承担立法、监督和选区代表职责。',
    sourceUrl: 'https://www.house.gov/the-house-explained',
  },
  'institution-xinhua': {
    introduction: '新华社是中国国家通讯社，提供面向国内外的多语种新闻采集与发布服务。',
    sourceUrl: 'https://www.news.cn/xinhuashe/jbqk.htm',
  },
};
