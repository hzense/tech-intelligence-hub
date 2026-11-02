import type { SeedSignal, SeedSource } from '@hzense/content';
import { SIGNAL_EVENT_TYPE_LABELS, isSignalEventType } from '@hzense/ingestion/signal-types';

export const signalTypeLabels = SIGNAL_EVENT_TYPE_LABELS;

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

export function formatSignalType(value: SeedSignal['type'] | 'editorial'): string {
  return value === 'editorial'
    ? '未分类'
    : isSignalEventType(value)
      ? signalTypeLabels[value]
      : '待重新分类';
}

export function formatSourceType(value: SeedSource['type']): string {
  return sourceTypeLabels[value];
}

export function formatPercentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}
