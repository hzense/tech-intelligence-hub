import 'server-only';
import pg from 'pg';
import {
  saveEditorialSignal,
  readEditorialSignal,
} from '../../../../packages/database/src/editorial-signal-store.mjs';
import { assertEditorialRole } from '../../../../packages/database/src/editorial-signal-role.mjs';
import { createEditorialReviewService } from '../editorial-review-service';
import { readCandidateRoleConfiguration } from '../candidate-review-config';
import { generationRecord } from './signal-generation';
import { buildCandidateReview, buildEnrichedCandidateReview } from '../candidate-review';
import { listCandidateEnrichmentDtos } from './candidate-enrichment';
import { materialPublicationPreview } from './material-registration';
import { getTopicTitleMap } from '../content-runtime';
import type { EditorialContent } from '../editorial-review';

let pool: pg.Pool | undefined;
let poolUrl: string | undefined;
function writerUrl() {
  return readCandidateRoleConfiguration(
    process.env,
    'HZENSE_EDITORIAL_DATABASE_URL',
    'hzense_editorial_writer',
  );
}
function enabled() {
  if (process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED !== '1') return false;
  try {
    writerUrl();
    readCandidateRoleConfiguration(
      process.env,
      'HZENSE_EDITORIAL_READER_DATABASE_URL',
      'hzense_editorial_reader',
    );
    return true;
  } catch {
    return false;
  }
}
const editorialPool = {
  async connect() {
    const url = writerUrl();
    if (poolUrl && poolUrl !== url)
      throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
    if (!pool) {
      poolUrl = url;
      pool = new pg.Pool({
        connectionString: url,
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 3500,
        query_timeout: 20000,
        allowExitOnIdle: true,
        enableChannelBinding: true,
        application_name: 'hzense-editorial-writer',
      });
      pool.on('error', () => console.error('editorial_database_unavailable'));
    }
    const client = await pool.connect();
    try {
      await assertEditorialRole(client, 'writer');
      return client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  },
};
async function material(owner: string, runId: string, index: number) {
  const run = await generationRecord(owner, runId);
  const original = buildCandidateReview(run, index);
  let candidate = original.candidate;
  const warnings: string[] = [];
  try {
    const enrichments = await listCandidateEnrichmentDtos(
      owner,
      runId,
      index,
      original.materialHash,
    );
    const latest = enrichments.find(
      (row) => row.status === 'completed' && row.material_hash === original.materialHash,
    );
    if (latest?.result?.candidate)
      candidate = buildEnrichedCandidateReview(
        run,
        index,
        latest.result.candidate as Record<string, unknown>,
      ).candidate;
  } catch {
    warnings.push('历史 AI 补全暂不可读取，当前按原候选展示；可直接手动补充并确认。');
  }
  let prefill;
  try {
    prefill = (await materialPublicationPreview(owner, runId, index, original))?.editorialPrefill;
  } catch {
    warnings.push('历史补证提案暂不可读取；不影响手动填写四项信息。');
  }
  const content: EditorialContent = {
    title: original.candidate.title,
    summary: original.candidate.summary,
    eventDate: prefill?.eventDate ?? candidate.event_date,
    organizations: prefill?.organizations ?? [
      ...new Set([
        ...candidate.organizations,
        ...candidate.persons.flatMap((person) =>
          person.organization ? [person.organization] : [],
        ),
      ]),
    ],
    persons: prefill?.persons ?? candidate.persons.map((person) => person.name),
    topics: prefill?.topics ?? [],
    // Imported private documents and arbitrary input URLs are not made public
    // merely by entering four fields. Original evidence remains in the admin UI.
    sourceUrls: [],
  };
  return { materialHash: original.materialHash, content, warnings };
}
const service = createEditorialReviewService({
  enabled,
  material,
  topics: async () => {
    if (!enabled()) return [...(await getTopicTitleMap())].map(([id, title]) => ({ id, title }));
    const client = await editorialPool.connect();
    try {
      const rows = (
        await client.query(
          "SELECT id,title FROM public.topics WHERE runtime_enabled IS TRUE AND status<>'archived' ORDER BY title,id LIMIT 1001",
        )
      ).rows;
      if (rows.length > 1000) throw new Error('editorial_catalog_unavailable');
      return rows;
    } finally {
      client.release();
    }
  },
  read: (owner, runId, candidateIndex) =>
    readEditorialSignal({ pool: editorialPool, owner, runId, candidateIndex }),
  save: (owner, request, bound) =>
    saveEditorialSignal({ pool: editorialPool, owner, request, material: bound }),
});
export const editorialDashboard = service.read;
export const writeEditorialReview = service.write;
