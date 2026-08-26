import type { SeedEntity } from '@hzense/content';

const entityTypeLabels = {
  person: '人物',
  company: '公司',
  institution: '机构',
  technology: '技术',
  product: '产品',
  model: '模型',
  dataset: '数据集',
  standard_protocol: '标准与协议',
  paper: '论文',
  event: '事件',
} satisfies Record<SeedEntity['type'], string>;

const relationTypeLabels: Record<string, string> = {
  works_at: '任职于',
  founded: '创立',
  leads: '领导',
  advises: '顾问',
  invests_in: '投资',
  acquired: '收购',
  invested_in: '被投资',
  partnered_with: '合作',
  competes_with: '竞争',
  supplies: '供应',
  customer_of: '客户',
  develops: '开发',
  owns: '拥有',
  uses: '使用',
  integrates: '集成',
  commercializes: '商业化',
  employs: '雇佣',
  researches: '研究',
  created: '创建',
  collaborates_with: '协作',
  authored_by: '作者',
  published_by: '发布者',
  supports: '支持',
  challenges: '挑战',
  related_to: '关联',
  mentions: '提及',
  influences: '影响',
  depends_on: '依赖',
  part_of: '属于',
  trained_on: '训练于',
  evaluated_on: '评测于',
  implements: '实现',
  conforms_to: '遵循',
  successor_of: '继任',
  version_of: '版本',
  presented_at: '发布于',
  organized_by: '组织者',
  announced_at: '宣布于',
};

export function formatEntityType(value: SeedEntity['type']): string {
  return entityTypeLabels[value];
}

export function formatRelationType(value: string): string {
  return relationTypeLabels[value] ?? value.replaceAll('_', ' ');
}
