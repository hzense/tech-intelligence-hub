import { rankSearchDocuments } from '@hzense/search/ranking';
import { readCandidateRoleConfiguration } from './candidate-review-config.ts';
import {
  PublicSignalReaderError,
  publicSignalMaximumEntries,
  type PublicSignalQueryClient,
  type SignalEntry,
} from './public-signal-reader-core.ts';

export const editorialSignalIdPattern = /^editorial-[a-f0-9]{32}$/;
export const editorialSignalListQuery = `SELECT signal_id, revision, content, published_at
FROM public.editorial_public_signals ORDER BY published_at DESC, signal_id LIMIT $1`;
export const editorialSignalByIdQuery = `SELECT signal_id, revision, content, published_at
FROM public.editorial_public_signals WHERE signal_id = $1`;

const fail = (): never => {
  throw new PublicSignalReaderError();
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
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
  return value.trim();
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) && value.length <= 256 ? value : fail();
}
export function editorialReaderConnectionString(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  try {
    return readCandidateRoleConfiguration(
      environment,
      'HZENSE_EDITORIAL_READER_DATABASE_URL',
      'hzense_editorial_reader',
    );
  } catch {
    return fail();
  }
}

export function mapEditorialSignalRows(rows: unknown[]): SignalEntry[] {
  if (!Array.isArray(rows) || rows.length > publicSignalMaximumEntries) return fail();
  return rows.map((value) => {
    const row = object(value);
    const signalId = text(row.signal_id);
    if (
      !editorialSignalIdPattern.test(signalId) ||
      !Number.isSafeInteger(row.revision) ||
      (row.revision as number) < 1
    )
      return fail();
    const content = object(row.content);
    const eventDate = text(content.eventDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return fail();
    const occurred = new Date(`${eventDate}T00:00:00.000Z`);
    if (!Number.isFinite(occurred.getTime()) || occurred.toISOString().slice(0, 10) !== eventDate)
      return fail();
    if (!(row.published_at instanceof Date) && typeof row.published_at !== 'string') return fail();
    const published = new Date(row.published_at);
    if (!Number.isFinite(published.getTime())) return fail();
    const names = (value: unknown, kind: string) =>
      array(value).map((name, index) => ({
        id: `${kind}-${index}`,
        name: text(name),
        event_role: '',
      }));
    const persons = names(content.persons, 'person');
    const organizations = names(content.organizations, 'organization');
    if (!persons.length || !organizations.length) return fail();
    const topics = array(content.topics).map((value) => {
      const topic = object(value);
      const id = text(topic.id);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return fail();
      return { id, title: text(topic.title) };
    });
    if (!topics.length) return fail();
    const sources = array(content.sourceUrls).map((value, index) => {
      const url = text(value);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return fail();
      }
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
        return fail();
      return { id: `source-${index}`, name: parsed.hostname, url };
    });
    return {
      id: signalId,
      title: text(content.title),
      summary: text(content.summary),
      type: 'editorial',
      publication_basis: 'manual_confirmation',
      status: 'accepted',
      occurred_at: occurred.toISOString(),
      captured_at: published.toISOString(),
      source_id: sources[0]?.id ?? '',
      source_url: sources[0]?.url ?? '',
      topics: topics.map((topic) => topic.id),
      entities: [],
      publication_revision: row.revision as number,
      public_people: persons,
      public_organizations: organizations,
      public_sources: sources,
      public_topics: topics,
    };
  });
}

export function createEditorialSignalReader(client: PublicSignalQueryClient) {
  async function read(sql: string, parameters: unknown[]) {
    try {
      return mapEditorialSignalRows((await client.query(sql, parameters)).rows);
    } catch {
      return fail();
    }
  }
  return {
    list: () => read(editorialSignalListQuery, [publicSignalMaximumEntries + 1]),
    async byId(id: string) {
      if (!editorialSignalIdPattern.test(id)) return undefined;
      const entries = await read(editorialSignalByIdQuery, [id]);
      if (entries.length > 1) return fail();
      return entries[0];
    },
  };
}

export function searchSignalEntries(entries: SignalEntry[], query: string) {
  return rankSearchDocuments(
    entries.map((entry) => ({
      id: entry.id,
      type: 'signal' as const,
      title: entry.title,
      summary: entry.summary,
      href: `/signals/${entry.id}`,
      date: entry.occurred_at.slice(0, 10),
      body: entry.analysis ?? '',
      keywords: [
        entry.type,
        ...entry.topics,
        ...(entry.public_topics ?? []).map((item) => item.title),
        ...(entry.public_people ?? []).map((item) => item.name),
        ...(entry.public_organizations ?? []).map((item) => item.name),
        ...(entry.public_sources ?? []).map((item) => `${item.name} ${item.url}`),
      ].join(' '),
    })),
    query,
    'signal',
  );
}
