import type { SeedSignal, SeedSource } from '@hzense/content';

const signalTypeLabels = {
  research: '研究',
  product: '产品',
  funding: '融资',
  acquisition: '收购',
  hiring: '人才',
  policy: '政策',
  technology: '技术',
  market: '市场',
  people: '人物',
  open_source: '开源',
  security: '安全',
  patent: '专利',
  partnership: '合作',
  regulation: '监管',
  supply_chain: '供应链',
} satisfies Record<SeedSignal['type'], string>;

const sourceTypeLabels = {
  website: '网站',
  rss: 'RSS',
  paper: '论文',
  company_blog: '公司公告',
  research_lab: '研究机构',
  news_media: '新闻媒体',
  newsletter: 'Newsletter',
  github: 'GitHub',
  social: '社交媒体',
  regulator: '监管机构',
  patent_database: '专利数据库',
} satisfies Record<SeedSource['type'], string>;

export function formatSignalType(value: SeedSignal['type']): string {
  return signalTypeLabels[value];
}

export function formatSourceType(value: SeedSource['type']): string {
  return sourceTypeLabels[value];
}

export function formatPercentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}
