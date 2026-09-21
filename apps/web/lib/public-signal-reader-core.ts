import type { SeedSignal } from '@hzense/content';
import {
  assertSearchQuery,
  compareSearchResults,
  rankSearchDocuments,
  tokenizeSearchQuery,
  type SearchResult,
} from '@hzense/search/ranking';
import {
  publicSignalByIdQuery,
  publicSignalListQuery,
  publicSignalSearchQuery,
} from '../../../packages/database/src/public-signal-query.mjs';

export { publicSignalByIdQuery, publicSignalListQuery, publicSignalSearchQuery };

export type SignalReadMode = 'legacy' | 'database';
export interface PublicSignalPerson {
  id: string;
  name: string;
  event_role: string;
}
export interface PublicSignalSource {
  id: string;
  name: string;
  url: string;
}
export type SignalEntry = SeedSignal & {
  public_version?: number;
  publication_revision?: number;
  analysis?: string;
  public_people?: PublicSignalPerson[];
  public_organizations?: PublicSignalPerson[];
  public_sources?: PublicSignalSource[];
  public_topics?: { id: string; title: string }[];
};

export class PublicSignalReaderError extends Error {
  constructor() {
    super('Public signals are unavailable');
    this.name = 'PublicSignalReaderError';
  }
}

const fail = (): never => {
  throw new PublicSignalReaderError();
};
export function readSignalReadMode(
  environment: Readonly<Record<string, string | undefined>>,
): SignalReadMode {
  const mode = environment.HZENSE_SIGNAL_READ_MODE;
  if (mode === undefined || mode === 'legacy') return 'legacy';
  if (mode === 'database') return mode;
  return fail();
}

export const publicSignalMaximumEntries = 10_000;

const signalTypes = new Set([
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
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 100_000 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    })
  )
    return fail();
  return value;
}
function id(value: unknown): string {
  const result = text(value);
  if (result.length > 200 || result.match(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)?.[0] !== result)
    return fail();
  return result;
}
function number(value: unknown, minimum: number, maximum: number, integer = false): number {
  // PostgreSQL numeric is a string; accept only an ordinary finite decimal.
  const parsed = typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  if (
    typeof parsed !== 'number' ||
    !Number.isFinite(parsed) ||
    parsed < minimum ||
    parsed > maximum ||
    (integer && !Number.isSafeInteger(parsed))
  )
    return fail();
  return parsed;
}
function date(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== 'string') return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fail();
  return parsed.toISOString();
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 256) return fail();
  return value;
}
function people(value: unknown): PublicSignalPerson[] {
  return array(value).map((item) => {
    const row = object(item);
    return { id: id(row.id), name: text(row.name), event_role: text(row.event_role) };
  });
}
function source(value: unknown): PublicSignalSource {
  const row = object(value);
  const sourceUrl = text(row.url);
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return fail();
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return fail();
  return { id: id(row.id), name: text(row.name), url: sourceUrl };
}

export function mapPublicSignalRows(rows: unknown[]): SignalEntry[] {
  if (!Array.isArray(rows) || rows.length > publicSignalMaximumEntries) return fail();
  return rows.map((value) => {
    const row = object(value);
    const sources = array(row.sources).map(source);
    const persons = people(row.people);
    const organizations = people(row.organizations);
    const topics = array(row.topics).map((value) => {
      const topic = object(value);
      return { id: id(topic.id), title: text(topic.title) };
    });
    if (!sources[0] || persons.length === 0 || !signalTypes.has(text(row.type))) return fail();
    // status is a legacy rendering adapter only. Eligibility derives exclusively
    // from current_public_signals; no Seed status is used to grant publication.
    return {
      id: id(row.signal_id),
      title: text(row.title),
      type: row.type as SeedSignal['type'],
      occurred_at: date(row.occurred_at),
      captured_at: date(row.captured_at),
      status: 'accepted',
      source_id: sources[0].id,
      source_url: sources[0].url,
      summary: text(row.summary),
      importance: number(row.importance, 1, 5, true),
      strength: number(row.strength, 1, 5, true),
      confidence: number(row.confidence, 0, 1),
      novelty: number(row.novelty, 0, 1),
      topics: topics.map((topic) => topic.id),
      entities: [...new Set([...persons, ...organizations].map((person) => person.id))],
      public_version: number(row.version, 1, Number.MAX_SAFE_INTEGER, true),
      publication_revision: number(row.publication_revision, 1, Number.MAX_SAFE_INTEGER, true),
      analysis: text(row.analysis),
      public_people: persons,
      public_organizations: organizations,
      public_sources: sources,
      public_topics: topics,
    };
  });
}

export interface PublicSignalQueryClient {
  query(sql: string, parameters: unknown[]): Promise<{ rows: unknown[] }>;
}
export function createPublicSignalReader(client: PublicSignalQueryClient) {
  async function executeQuery(sql: string, parameters: unknown[]) {
    try {
      return await client.query(sql, parameters);
    } catch {
      // Never surface database diagnostics or connection details to public routes.
      return fail();
    }
  }
  return {
    async list(): Promise<SignalEntry[]> {
      return mapPublicSignalRows(
        (await executeQuery(publicSignalListQuery, [publicSignalMaximumEntries + 1])).rows,
      );
    },
    async byId(signalId: string): Promise<SignalEntry | undefined> {
      if (signalId.match(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)?.[0] !== signalId || signalId.length > 200)
        return undefined;
      const rows = (await executeQuery(publicSignalByIdQuery, [signalId])).rows;
      if (!Array.isArray(rows) || rows.length > 1) return fail();
      return mapPublicSignalRows(rows)[0];
    },
    async search(query: string): Promise<SearchResult[]> {
      assertSearchQuery(query);
      const terms = tokenizeSearchQuery(query);
      if (!terms.length) return [];
      const entries = mapPublicSignalRows(
        (await executeQuery(publicSignalSearchQuery, [terms, publicSignalMaximumEntries + 1])).rows,
      );
      return rankSearchDocuments(
        entries.map((entry) => ({
          id: entry.id,
          type: 'signal',
          title: entry.title,
          summary: entry.summary,
          href: `/signals/${entry.id}`,
          date: entry.occurred_at.slice(0, 10),
          body: entry.analysis ?? '',
          keywords: [
            entry.type,
            ...(entry.public_topics ?? []).map((topic) => `${topic.id} ${topic.title}`),
            ...(entry.public_people ?? []).map((person) => `${person.id} ${person.name}`),
            ...(entry.public_organizations ?? []).map((person) => `${person.id} ${person.name}`),
            ...(entry.public_sources ?? []).map((item) => `${item.id} ${item.name} ${item.url}`),
          ].join(' '),
        })),
        query,
        'signal',
      );
    },
  };
}

export function mergeCurrentSignalSearch(
  legacy: SearchResult[],
  current: SearchResult[],
): SearchResult[] {
  return [
    ...legacy.filter((result) => result.type !== 'signal' && !result.href.startsWith('/signals/')),
    ...current,
  ].sort(compareSearchResults);
}
