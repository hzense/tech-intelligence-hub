import type { TopicEntry } from './content-runtime';

type TopicFrontMatter = TopicEntry['frontMatter'];

const statusLabels = {
  watching: '持续关注',
  active: '活跃',
  strategic: '战略',
  archived: '已归档',
} satisfies Record<TopicFrontMatter['status'], string>;

const trendLabels = {
  rapid_growth: '快速上升',
  growth: '上升',
  stable: '稳定',
  decline: '下降',
  rapid_decline: '快速下降',
} satisfies Record<NonNullable<TopicFrontMatter['trend']>, string>;

const maturityLabels = {
  research: '研究期',
  early: '早期',
  emerging: '涌现期',
  growth: '成长期',
  mature: '成熟期',
} satisfies Record<NonNullable<TopicFrontMatter['maturity']>, string>;

const strategicValueLabels = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '关键',
} satisfies Record<NonNullable<TopicFrontMatter['strategic_value']>, string>;

export function formatTopicStatus(value: TopicFrontMatter['status']): string {
  return statusLabels[value];
}

export function formatTopicTrend(value: TopicFrontMatter['trend']): string {
  return value ? trendLabels[value] : '待评估';
}

export function formatTopicMaturity(value: TopicFrontMatter['maturity']): string {
  return value ? maturityLabels[value] : '待评估';
}

export function formatTopicStrategicValue(
  value: TopicFrontMatter['strategic_value'],
): string {
  return value ? strategicValueLabels[value] : '待评估';
}
