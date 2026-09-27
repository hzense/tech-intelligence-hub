import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { SeedEntity } from '@hzense/content';
import type { SignalEntry, PublicSignalPerson } from './public-signal-reader-core.ts';
import { signalPublication, toUnifiedSignal } from './unified-signal-core.ts';

export const signalPageSize = 12;
export type ExplorationParams = Record<string, string | string[] | undefined>;
export interface ExplorationTopic {
  id: string;
  name: string;
  parentId: string | null;
}
export interface SignalFilters {
  archive: boolean;
  q: string;
  keyword: string;
  from: string;
  to: string;
  domain: string;
  topic: string;
  person: string;
  organization: string;
  view: 'list' | 'timeline' | 'domain';
  cursor: string;
  invalid: boolean;
}

/** Eligibility is granted by the public readers, never inferred from Seed status. */
export function isCurrentSignal(entry: SignalEntry): boolean {
  return signalPublication(entry).state === 'published';
}

function first(params: ExplorationParams, key: string): string {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseSignalFilters(params: ExplorationParams): SignalFilters {
  const from = first(params, 'from');
  const to = first(params, 'to');
  const view = first(params, 'view');
  const filters: SignalFilters = {
    archive: first(params, 'archive') === '1',
    q: first(params, 'q').slice(0, 120),
    keyword: first(params, 'keyword').slice(0, 120),
    from,
    to,
    domain: first(params, 'domain').slice(0, 200),
    topic: first(params, 'topic').slice(0, 200),
    person: first(params, 'person').slice(0, 200),
    organization: first(params, 'organization').slice(0, 200),
    view: view === 'timeline' || view === 'domain' ? view : 'list',
    cursor: first(params, 'cursor').slice(0, 4000),
    invalid: Boolean(
      (from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to),
    ),
  };
  return filters;
}

export function signalDomainIds(entry: SignalEntry, topics: readonly ExplorationTopic[]): string[] {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  return [
    ...new Set(
      entry.topics.flatMap((id) => {
        let topic = byId.get(id);
        if (!topic) return [];
        const visited = new Set<string>();
        while (topic.parentId) {
          if (visited.has(topic.id)) return [];
          visited.add(topic.id);
          const parent = byId.get(topic.parentId);
          if (!parent) return [];
          topic = parent;
        }
        return [topic.id];
      }),
    ),
  ];
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN');
}

/** A name filter is not an entity ID and cannot be used as a resource URL. */
export function signalNameFilterKey(name: string): string {
  return `name:${createHash('sha256').update(normalized(name).trim()).digest('hex')}`;
}

export function nameOnlySignalFilters(
  signals: readonly SignalEntry[],
  kind: 'person' | 'organization',
): { id: string; name: string }[] {
  const names = new Map<string, string>();
  for (const signal of signals) {
    const unified = toUnifiedSignal(signal);
    const rows = kind === 'person' ? unified.people : unified.organizations;
    for (const row of rows) {
      if (row.id !== null) continue;
      const key = signalNameFilterKey(row.name);
      if (!names.has(key)) names.set(key, row.name);
    }
  }
  return [...names].map(([id, name]) => ({ id, name }));
}

function filterKey(filters: SignalFilters): string {
  return JSON.stringify([
    filters.archive,
    filters.q,
    filters.keyword,
    filters.from,
    filters.to,
    filters.domain,
    filters.topic,
    filters.person,
    filters.organization,
  ]);
}

export function selectSignals(
  signals: readonly SignalEntry[],
  filters: SignalFilters,
  topics: readonly ExplorationTopic[],
  seedEntities: readonly SeedEntity[] = [],
) {
  const entities = new Map(seedEntities.map((entity) => [entity.id, entity]));
  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  const scope = signals.filter((entry) =>
    filters.archive ? !isCurrentSignal(entry) : isCurrentSignal(entry),
  );
  const matched = filters.invalid
    ? []
    : scope
        .filter((entry) => {
          const day = entry.occurred_at.slice(0, 10);
          if ((filters.from && day < filters.from) || (filters.to && day > filters.to))
            return false;
          if (filters.domain && !signalDomainIds(entry, topics).includes(filters.domain))
            return false;
          if (filters.topic && !entry.topics.includes(filters.topic)) return false;
          const unified = toUnifiedSignal(entry);
          const people =
            isCurrentSignal(entry) && entry.public_people !== undefined
              ? unified.people
              : entry.entities
                  .filter((id) => entities.get(id)?.type === 'person')
                  .map((id) => ({ id, name: entities.get(id)?.name ?? id, eventRole: '' }));
          const organizations =
            isCurrentSignal(entry) && entry.public_organizations !== undefined
              ? unified.organizations
              : entry.entities
                  .filter((id) => ['company', 'institution'].includes(entities.get(id)?.type ?? ''))
                  .map((id) => ({ id, name: entities.get(id)?.name ?? id, eventRole: '' }));
          if (
            filters.person &&
            !people.some((person) =>
              filters.person.startsWith('name:')
                ? person.id === null && signalNameFilterKey(person.name) === filters.person
                : person.id === filters.person,
            )
          )
            return false;
          if (
            filters.organization &&
            !organizations.some((organization) =>
              filters.organization.startsWith('name:')
                ? organization.id === null &&
                  signalNameFilterKey(organization.name) === filters.organization
                : organization.id === filters.organization,
            )
          )
            return false;
          const text = normalized(
            [
              entry.title,
              entry.summary,
              entry.analysis ?? '',
              ...(entry.public_people ?? []).map((person) => person.name),
              ...(entry.public_organizations ?? []).map((organization) => organization.name),
              ...entry.topics.map((id) => topicNames.get(id) ?? id),
              ...entry.entities.map((id) => entities.get(id)?.name ?? ''),
            ].join(' '),
          );
          return [filters.q, filters.keyword].every((value) =>
            normalized(value)
              .split(/\s+/)
              .filter(Boolean)
              .every((term) => text.includes(term)),
          );
        })
        .sort(
          (left, right) =>
            right.occurred_at.localeCompare(left.occurred_at) || left.id.localeCompare(right.id),
        );
  let remaining = matched;
  let invalidCursor = false;
  if (filters.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString('utf8'));
      if (
        cursor.key !== filterKey(filters) ||
        typeof cursor.date !== 'string' ||
        typeof cursor.id !== 'string'
      )
        throw new Error('Invalid cursor');
      // Keyset pagination still works when the previous anchor was withdrawn.
      remaining = matched.filter(
        (entry) =>
          entry.occurred_at < cursor.date ||
          (entry.occurred_at === cursor.date && entry.id > cursor.id),
      );
    } catch {
      invalidCursor = true;
      remaining = [];
    }
  }
  const entries = remaining.slice(0, signalPageSize);
  const last = entries.at(-1);
  const nextCursor =
    remaining.length > signalPageSize && last
      ? Buffer.from(
          JSON.stringify({ key: filterKey(filters), date: last.occurred_at, id: last.id }),
        ).toString('base64url')
      : undefined;
  return {
    entries,
    total: matched.length,
    scopeCount: scope.length,
    nextCursor,
    invalidCursor,
    matched,
  };
}

export function signalFilterHref(
  filters: SignalFilters,
  changes: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const key of [
    'q',
    'keyword',
    'from',
    'to',
    'domain',
    'topic',
    'person',
    'organization',
    'view',
    'cursor',
  ] as const) {
    if (filters[key] && !(key === 'view' && filters[key] === 'list')) params.set(key, filters[key]);
  }
  if (filters.archive) params.set('archive', '1');
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `/signals${params.size ? `?${params.toString()}` : ''}`;
}

export interface PublicEntitySummary {
  id: string;
  name: string;
  type: SeedEntity['type'];
  signals: SignalEntry[];
  recentCount: number;
  latestAt?: string;
  relatedPeople: PublicSignalPerson[];
  relatedOrganizations: PublicSignalPerson[];
}

/** Shared event references are co-occurrence, not evidence of employment. */
export function buildPublicEntityDirectory(
  signals: readonly SignalEntry[],
  seedEntities: readonly SeedEntity[] = [],
  now = new Date(),
): PublicEntitySummary[] {
  const directory = new Map<string, PublicEntitySummary>();
  const add = (id: string, name: string, type: SeedEntity['type']) => {
    if (!directory.has(id))
      directory.set(id, {
        id,
        name,
        type,
        signals: [],
        recentCount: 0,
        relatedPeople: [],
        relatedOrganizations: [],
      });
    return directory.get(id)!;
  };
  // Public names win over historical registry names; identity is ID, never display name.
  const sorted = [...signals].sort(
    (a, b) => b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id),
  );
  for (const signal of sorted) {
    const unified = toUnifiedSignal(signal);
    for (const person of unified.people)
      if (person.id !== null) add(person.id, person.name, 'person');
    for (const organization of unified.organizations)
      if (organization.id !== null) add(organization.id, organization.name, 'institution');
  }
  for (const entity of seedEntities) {
    if (entity.status !== 'active') continue;
    const existing = directory.get(entity.id);
    if (existing) {
      // Public signals supply the current display name; the registry knows whether
      // an organization is a company, institution, or another concrete type.
      existing.type = entity.type;
    } else {
      add(entity.id, entity.name, entity.type);
    }
  }
  const cutoff = now.getTime() - 30 * 86_400_000;
  for (const signal of sorted) {
    const ids = new Set(
      isCurrentSignal(signal)
        ? [...toUnifiedSignal(signal).people, ...toUnifiedSignal(signal).organizations]
            .map((entry) => entry.id)
            .filter((id): id is string => id !== null)
        : signal.entities,
    );
    for (const id of ids) {
      const entity = directory.get(id);
      if (!entity || entity.signals.some((entry) => entry.id === signal.id)) continue;
      entity.signals.push(signal);
      entity.latestAt ??= signal.occurred_at;
      const time = new Date(signal.occurred_at).getTime();
      if (time >= cutoff && time <= now.getTime()) entity.recentCount += 1;
      for (const person of signal.publication_basis === 'manual_confirmation'
        ? []
        : (signal.public_people ?? [])) {
        if (person.id !== id && !entity.relatedPeople.some((item) => item.id === person.id))
          entity.relatedPeople.push(person);
      }
      for (const organization of signal.publication_basis === 'manual_confirmation'
        ? []
        : (signal.public_organizations ?? [])) {
        if (
          organization.id !== id &&
          !entity.relatedOrganizations.some((item) => item.id === organization.id)
        )
          entity.relatedOrganizations.push(organization);
      }
    }
  }
  return [...directory.values()].sort(
    (a, b) =>
      b.recentCount - a.recentCount ||
      (b.latestAt ?? '').localeCompare(a.latestAt ?? '') ||
      a.id.localeCompare(b.id),
  );
}
