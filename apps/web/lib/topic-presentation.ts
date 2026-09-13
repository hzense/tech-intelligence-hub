import type { FrontMatter, SeedRadarSnapshot } from '@hzense/content';
import {
  formatRadarMaturity,
  formatRadarStrategicValue,
  formatRadarTrend,
} from './radar-presentation.ts';

type TopicFrontMatter = Extract<FrontMatter, { type: 'topic' }>;

const statusLabels = {
  watching: '持续关注',
  active: '活跃',
  strategic: '战略',
  archived: '已归档',
} satisfies Record<TopicFrontMatter['status'], string>;

export function formatTopicStatus(value: TopicFrontMatter['status']): string {
  return statusLabels[value];
}

export function formatTopicTrend(value: SeedRadarSnapshot['trend'] | undefined): string {
  return value ? formatRadarTrend(value) : '待评估';
}

export function formatTopicMaturity(value: SeedRadarSnapshot['maturity'] | undefined): string {
  return value ? formatRadarMaturity(value) : '待评估';
}

export function formatTopicStrategicValue(
  value: SeedRadarSnapshot['strategic_value'] | undefined,
): string {
  return value ? formatRadarStrategicValue(value) : '待评估';
}
