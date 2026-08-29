import type { SeedRadarSnapshot } from '@hzense/content';

export const radarDomainOptions = [
  { value: 'artificial_intelligence', label: '人工智能' },
  { value: 'infrastructure', label: '基础设施' },
  { value: 'security', label: '安全' },
  { value: 'robotics', label: '机器人' },
] as const;

export const radarMaturityOptions = [
  { value: 'research', label: '研究期' },
  { value: 'early', label: '早期' },
  { value: 'emerging', label: '涌现期' },
  { value: 'growth', label: '成长期' },
  { value: 'mature', label: '成熟期' },
] as const;

export const radarTrendOptions = [
  { value: 'rapid_growth', label: '快速上升' },
  { value: 'growth', label: '上升' },
  { value: 'stable', label: '稳定' },
  { value: 'decline', label: '下降' },
  { value: 'rapid_decline', label: '快速下降' },
] as const;

const strategicValueLabels = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '关键',
} satisfies Record<SeedRadarSnapshot['strategic_value'], string>;

export function formatRadarDomain(value: SeedRadarSnapshot['domain']): string {
  return radarDomainOptions.find((option) => option.value === value)?.label ?? value;
}

export function formatRadarMaturity(value: SeedRadarSnapshot['maturity']): string {
  return radarMaturityOptions.find((option) => option.value === value)?.label ?? value;
}

export function formatRadarTrend(value: SeedRadarSnapshot['trend']): string {
  return radarTrendOptions.find((option) => option.value === value)?.label ?? value;
}

export function formatRadarStrategicValue(value: SeedRadarSnapshot['strategic_value']): string {
  return strategicValueLabels[value];
}

export function isRadarDomain(value: string): value is SeedRadarSnapshot['domain'] {
  return radarDomainOptions.some((option) => option.value === value);
}

export function isRadarMaturity(value: string): value is SeedRadarSnapshot['maturity'] {
  return radarMaturityOptions.some((option) => option.value === value);
}

export function isRadarTrend(value: string): value is SeedRadarSnapshot['trend'] {
  return radarTrendOptions.some((option) => option.value === value);
}
