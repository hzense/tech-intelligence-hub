import type { GenerationSignalType } from '../../../packages/ingestion/src/signal-types.mjs';
export type EditorialResource = {
  type: 'person' | 'company' | 'institution';
  name: string;
  introduction: string | null;
  event_role: string | null;
  evidence: Array<{ fragment_id: string; quote: string }>;
  entity_id: string | null;
  source_urls?: string[];
};
export type EditorialResourceOption = {
  name: string;
  type: EditorialResource['type'];
  matches: Array<{ id: string; name: string; type: EditorialResource['type'] }>;
  status: 'new' | 'reuse' | 'ambiguous';
};
export type EditorialResourceSourceOption = {
  name: string;
  type: EditorialResource['type'];
  sourceUrls: string[];
};
export const editorialResourceSameKind = (
  left: Pick<EditorialResource, 'type'>,
  right: Pick<EditorialResource, 'type'>,
) => (left.type === 'person') === (right.type === 'person');
export type EditorialContent = {
  title: string;
  summary: string;
  eventDate: string | null;
  organizations: string[];
  persons: string[];
  topics: Array<{ id: string; title: string }>;
  sourceUrls: string[];
  signalType?: GenerationSignalType | null;
  resources?: EditorialResource[];
};
export type EditorialDashboard = {
  configured: boolean;
  materialHash: string;
  revision: number;
  action: 'draft' | 'publish' | 'withdraw' | null;
  content: EditorialContent;
  topicOptions: Array<{ id: string; title: string }>;
  sourceOptions?: string[];
  resourceOptions?: EditorialResourceOption[];
  resourceSourceOptions?: EditorialResourceSourceOption[];
  warnings: string[];
  requestId: string | null;
  publicId: string | null;
};

export function editorialMissing(
  content: EditorialContent,
  resourceOptions: EditorialResourceOption[] = [],
  resourceSourceOptions: EditorialResourceSourceOption[] = [],
): string[] {
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
  if (
    (content.resources === undefined && !content.persons.length) ||
    content.persons.some((name) => !name.trim())
  )
    missing.push('人物');
  if (!content.topics.length) missing.push('领域');
  if (content.resources?.length && !content.sourceUrls.length) missing.push('公开来源');
  for (const resource of content.resources ?? []) {
    const source = resourceSourceOptions.find(
      (entry) => entry.name === resource.name && editorialResourceSameKind(entry, resource),
    );
    if (!source?.sourceUrls.some((url) => content.sourceUrls.includes(url)))
      missing.push(`${resource.name} 的公开来源`);
  }
  for (const option of resourceOptions) {
    const resource = content.resources?.find(
      (entry) => entry.name === option.name && editorialResourceSameKind(entry, option),
    );
    if (
      (option.status === 'ambiguous' || option.matches.length > 0) &&
      resource?.entity_id !== '__new__' &&
      !option.matches.some(
        (match) =>
          resource && match.id === resource.entity_id && editorialResourceSameKind(match, resource),
      )
    )
      missing.push(`${option.name} 的资源身份`);
  }
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
