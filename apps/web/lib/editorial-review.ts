import type { GenerationSignalType } from '../../../packages/ingestion/src/signal-types.mjs';
export type EditorialContent = {
  title: string;
  summary: string;
  eventDate: string | null;
  organizations: string[];
  persons: string[];
  topics: Array<{ id: string; title: string }>;
  sourceUrls: string[];
  signalType?: GenerationSignalType | null;
};
export type EditorialDashboard = {
  configured: boolean;
  materialHash: string;
  revision: number;
  action: 'draft' | 'publish' | 'withdraw' | null;
  content: EditorialContent;
  topicOptions: Array<{ id: string; title: string }>;
  sourceOptions?: string[];
  warnings: string[];
  requestId: string | null;
  publicId: string | null;
};

export function editorialMissing(content: EditorialContent): string[] {
  const missing: string[] = [];
  if (!content.signalType) missing.push('事件类型');
  const date = content.eventDate;
  if (
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    missing.push('事件日期');
  if (!content.organizations.length || content.organizations.some((name) => !name.trim()))
    missing.push('组织');
  if (!content.persons.length || content.persons.some((name) => !name.trim())) missing.push('人物');
  if (!content.topics.length) missing.push('领域');
  return missing;
}

export function editorialNames(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,，、;；]+/u)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}
