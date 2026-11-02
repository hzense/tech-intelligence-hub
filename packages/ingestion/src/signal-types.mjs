/** Persisted categories: keep retired values readable for historical snapshots and receipts. */
export const LEGACY_SIGNAL_TYPES = Object.freeze([
  'research',
  'product',
  'funding',
  'acquisition',
  'hiring',
  'policy',
  'technology',
  'market',
  'people',
  'open_source',
  'security',
  'patent',
  'partnership',
  'regulation',
  'supply_chain',
]);

/** New generation and publication classify the event, not its technology or openness. */
export const SIGNAL_EVENT_TYPE_LABELS = Object.freeze({
  research: '研究成果发布',
  product: '产品发布与更新',
  funding: '融资',
  acquisition: '收购合并',
  hiring: '人才招聘',
  policy: '政策发布',
  people: '人事变动',
  patent: '专利进展',
  partnership: '合作签约',
  regulation: '监管行动',
  disclosure: '经营与信息披露',
  operations: '建设投产',
  incident: '事故事件',
});

export const SIGNAL_EVENT_TYPES = Object.freeze(Object.keys(SIGNAL_EVENT_TYPE_LABELS));
export const SIGNAL_TYPES = Object.freeze([
  ...LEGACY_SIGNAL_TYPES,
  ...SIGNAL_EVENT_TYPES.filter((value) => !LEGACY_SIGNAL_TYPES.includes(value)),
]);
export function isSignalEventType(value) {
  return typeof value === 'string' && SIGNAL_EVENT_TYPES.includes(value);
}

export const SIGNAL_EVENT_TYPE_RULES = `事件类型只回答“发生了什么”，每条信号只选择最贴近核心事件的一类：research（研究成果发布：论文、研究报告或评估结果公布）、product（产品发布与更新：新产品、版本、服务上线或产品量产发布）、funding（融资：募集资金，不含自有资金建设项目）、acquisition（收购合并）、hiring（人才招聘：招聘计划与团队招募）、policy（政策发布：政策、产业规划及扶持措施）、people（人事变动：具名人物任免、加入、离职及职务变化）、patent（专利进展：申请、公开或授权）、partnership（合作签约）、regulation（监管行动：调查、执法、处罚及具体合规决定）、disclosure（经营与信息披露：财报、经营或行业统计、商业声明与风险公告，不将公告本身当作事故已发生）、operations（建设投产：基地或设施的建设规划、开工、扩产、投产及停产）、incident（事故事件：已发生的故障、攻击、泄露及其他事故，不含仅研究潜在风险）。
technology、security、market、supply_chain、open_source 已退出事件类型，不能作为 signal_type。技术与安全领域从 enabled_topics 中选择直接相关的 topic_ids；开源、供应链等特征可在标题摘要中准确说明，不据此创造领域 ID 或新的输出字段。研究论文即使讨论安全或供应链也按研究成果发布分类；开源产品发布按产品发布与更新分类；政策发布与具体监管执行、人事变动与招聘计划须按核心事件区分。不得为套用类型而编造融资、收购、合作或人员变动事实。`;
