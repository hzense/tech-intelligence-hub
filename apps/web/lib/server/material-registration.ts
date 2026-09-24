import 'server-only';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import * as store from '../../../../packages/database/src/candidate-material-store.mjs';
import { assertMaterialRole } from '../../../../packages/database/src/material-registration-role.mjs';
import {
  materialPlanHash,
  normalizeMaterialPlan,
  verifyMaterialAttestation,
} from '../../../../packages/database/src/material-registration-contract.mjs';
import {
  registerMaterialPlan,
  verifyRegisteredMaterialPlan,
} from '../../../../packages/database/src/material-registration-executor.mjs';
import { buildCandidateSourceBundle } from '../../../../packages/ingestion/src/candidate-source-bundle.mjs';
import { listImportBatches } from '../../../../packages/database/src/import-store.mjs';
import { generationRecord } from './signal-generation';
import { importPool, importsConfigured } from './generation-import-reader';
import { buildCandidateReview } from '../candidate-review';
import { readMaterialSupplement } from '../material-source-reader';
import {
  materialDatabaseConfiguration,
  materialKeyring,
  requireMaterialWrites,
  type MaterialRole,
} from '../material-registration-config';
import { bindMaterialPlan } from '../material-registration-binding';
import { validateGenerationSource } from '../../../../packages/ingestion/src/signal-generation-contract.mjs';

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
const uuid = (v: unknown): string =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v)
    ? v
    : fail('invalid_request');
const index = (v: unknown): number =>
  Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 4 ? Number(v) : fail('invalid_request');
const hash = (v: unknown): string =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : fail('invalid_request');
const exact = (v: unknown, keys: string[]): Record<string, unknown> => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(',') !== keys.sort().join(',')
  )
    fail('invalid_request');
  return v as Record<string, unknown>;
};
const pools = new Map<MaterialRole, { url: string; pool: pg.Pool }>();
export function materialPool(role: MaterialRole) {
  return {
    async connect() {
      const url = materialDatabaseConfiguration(process.env, role),
        old = pools.get(role);
      if (old && old.url !== url) fail('not_configured');
      if (!old) {
        const pool = new pg.Pool({
          connectionString: url,
          max: 1,
          connectionTimeoutMillis: 3500,
          idleTimeoutMillis: 10000,
          query_timeout: 15000,
          allowExitOnIdle: true,
          enableChannelBinding: true,
          application_name: `hzense-material-${role}`,
        });
        pool.on('error', () => console.error('material_database_unavailable'));
        pools.set(role, { url, pool });
      }
      const client = await pools.get(role)!.pool.connect();
      try {
        await assertMaterialRole(client, `hzense_material_${role}`);
        return client;
      } catch (e) {
        client.release(true);
        throw e;
      }
    },
  };
}
export function materialRegistrationConfigured() {
  try {
    materialDatabaseConfiguration(process.env, 'registrar');
    return true;
  } catch {
    return false;
  }
}

async function packet(owner: string, runId: string, candidateIndex: number) {
  const run = await generationRecord(owner, runId);
  return { run, review: buildCandidateReview(run, candidateIndex) };
}
async function originalSourceUrl(owner: string, run: Awaited<ReturnType<typeof generationRecord>>) {
  try {
    const source = await readMaterialSupplement(importPool, owner, run.batch_id, run.item_id);
    if (source.contentHash !== run.source_hash) return null;
    return source.sourceUrl;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'source_unavailable'
    )
      return null;
    throw error;
  }
}
async function originalUrlForPlan(
  owner: string,
  run: Awaited<ReturnType<typeof generationRecord>>,
  input: unknown,
  bundle: store.MaterialRequestRecord['bundle'],
) {
  const plan = normalizeMaterialPlan(input);
  const needsOriginal = plan.evidence.some(
    (evidence) =>
      !bundle.source.fragments.some(
        (fragment, index) =>
          bundle.provenance[index]?.kind === 'supplement' &&
          bundle.provenance[index]?.sourceUrl === evidence.sourceUrl &&
          fragment.text.includes(evidence.excerpt),
      ),
  );
  return needsOriginal ? originalSourceUrl(owner, run) : null;
}
function reportDto(report: store.MaterialReportRecord) {
  return {
    id: report.id,
    planHash: report.plan_hash,
    plan: normalizeMaterialPlan(report.plan),
    receivedAt: report.received_at,
    stages: (report.receipts ?? []).map((r) => r.stage),
  };
}
function requestDto(request: store.MaterialRequestRecord) {
  return {
    id: request.id,
    createdAt: request.created_at,
    bundleHash: request.bundle_hash,
    fragmentCount: request.bundle.source.fragments.length,
    reports: (request.reports ?? []).map(reportDto),
  };
}
export async function readMaterialDashboard(owner: string, runId: string, candidateIndex: number) {
  const { run } = await packet(owner, uuid(runId), index(candidateIndex));
  if (!materialRegistrationConfigured())
    return { configured: false, enabled: false, requests: [], sources: [] };
  const requests = await store.readMaterialRequests({
    pool: materialPool('registrar'),
    owner,
    runId,
    candidateIndex,
  });
  const batches = importsConfigured()
    ? await listImportBatches({ pool: importPool, owner, view: 'sources' })
    : [];
  return {
    configured: true,
    originalSourceAvailable: importsConfigured()
      ? Boolean(await originalSourceUrl(owner, run))
      : false,
    enabled: process.env.HZENSE_MATERIAL_REGISTRATION_ENABLED === '1',
    requests: requests.map(requestDto),
    sources: batches.flatMap((batch) =>
      batch.items
        .filter((item) => item.status === 'completed' && item.kind === 'url')
        .map((item) => ({
          batchId: batch.id,
          itemId: item.id,
          name: item.declaration.name ?? item.declaration.url,
          sourceUrl: item.declaration.url,
        })),
    ),
    sourceListNote:
      '显示最近的可用链接资料；同文的公开 URL 可补充出处，但仍需独立核验。其他来源请先导入解析。文件内容保留私有，不能直接登记为公开证据。',
  };
}
export async function createMaterialRequest(owner: string, input: unknown) {
  requireMaterialWrites(process.env);
  const body = exact(input, [
    'id',
    'runId',
    'candidateIndex',
    'materialHash',
    'supplements',
    'consent',
  ]);
  if (body.consent !== true || !Array.isArray(body.supplements) || body.supplements.length > 3)
    fail('invalid_request');
  const runId = uuid(body.runId),
    candidateIndex = index(body.candidateIndex),
    baseMaterialHash = hash(body.materialHash);
  const { run, review } = await packet(owner, runId, candidateIndex);
  if (review.materialHash !== baseMaterialHash) fail('material_changed');
  const requestId = uuid(body.id);
  const selections = body.supplements.map((input) => {
    const row = exact(input, ['batchId', 'itemId']);
    return { batchId: uuid(row.batchId), itemId: uuid(row.itemId) };
  });
  // A replay can recover an already committed immutable request even if the
  // original import has since been hidden. Never rebuild its source snapshot.
  let previous: store.MaterialRequestRecord | undefined;
  try {
    previous = await store.getMaterialRequest({
      pool: materialPool('registrar'),
      owner,
      id: requestId,
    });
  } catch (error) {
    if (!(error instanceof store.CandidateMaterialStoreError) || error.code !== 'not_found')
      throw error;
  }
  if (previous) {
    const oldSelections = [
      ...new Map(
        previous.bundle.provenance
          .filter((p) => p.kind === 'supplement')
          .map((p) => [p.itemId, { batchId: p.batchId, itemId: p.itemId }]),
      ).values(),
    ];
    if (
      previous.run_id !== runId ||
      previous.candidate_index !== candidateIndex ||
      previous.base_material_hash !== baseMaterialHash ||
      JSON.stringify(oldSelections) !== JSON.stringify(selections)
    )
      fail('request_id_conflict');
    return requestDto(previous);
  }
  const supplements = [];
  if (!selections.length && !(await originalSourceUrl(owner, run))) fail('source_unavailable');
  for (const row of selections) {
    supplements.push(
      await readMaterialSupplement(importPool, owner, uuid(row.batchId), uuid(row.itemId)),
    );
  }
  const bundle = buildCandidateSourceBundle({
    baseMaterialHash,
    source: validateGenerationSource(run.snapshot.source),
    supplements,
  });
  return requestDto(
    await store.createMaterialRequest({
      pool: materialPool('registrar'),
      owner,
      request: {
        id: requestId,
        runId,
        candidateIndex,
        baseMaterialHash,
        bundleHash: bundle.sourceBundleHash,
      },
      bundle,
    }),
  );
}
async function checkedReport(owner: string, requestId: string, reportId: string) {
  const request = await store.getMaterialRequest({
    pool: materialPool('registrar'),
    owner,
    id: uuid(requestId),
  });
  const report = await store.getMaterialReport({
    pool: materialPool('registrar'),
    owner,
    requestId: request.id,
    reportId: uuid(reportId),
  });
  const { run, review } = await packet(owner, request.run_id, request.candidate_index);
  const plan = bindMaterialPlan(report.plan, request.bundle, {
    owner,
    runId: request.run_id,
    candidateIndex: request.candidate_index,
    materialHash: review.materialHash,
    candidate: review.candidate,
    originalSourceUrl: await originalUrlForPlan(owner, run, report.plan, request.bundle),
  });
  if (materialPlanHash(plan) !== report.plan_hash) fail('material_changed');
  verifyMaterialAttestation({
    envelope: report.attestation,
    plan,
    trustedVerifiers: materialKeyring(process.env),
    now: new Date(report.received_at),
  });
  return { request, report, plan };
}
export async function acceptMaterialReport(input: unknown) {
  requireMaterialWrites(process.env);
  const body = exact(input, ['owner', 'requestId', 'plan', 'attestation']);
  if (typeof body.owner !== 'string') fail('invalid_request');
  const owner = body.owner;
  const request = await store.getMaterialRequest({
    pool: materialPool('verifier'),
    owner,
    id: uuid(body.requestId),
  });
  const { run, review } = await packet(owner, request.run_id, request.candidate_index);
  const plan = bindMaterialPlan(body.plan, request.bundle, {
    owner,
    runId: request.run_id,
    candidateIndex: request.candidate_index,
    materialHash: review.materialHash,
    candidate: review.candidate,
    originalSourceUrl: await originalUrlForPlan(owner, run, body.plan, request.bundle),
  });
  let existing: store.MaterialReportRecord | undefined;
  try {
    existing = await store.getMaterialReport({
      pool: materialPool('verifier'),
      owner,
      requestId: request.id,
      planHash: materialPlanHash(plan),
    });
  } catch (error) {
    if (!(error instanceof store.CandidateMaterialStoreError) || error.code !== 'not_found')
      throw error;
  }
  verifyMaterialAttestation({
    envelope: existing?.attestation ?? body.attestation,
    plan,
    trustedVerifiers: materialKeyring(process.env),
    ...(existing ? { now: new Date(existing.received_at) } : {}),
  });
  if (existing) return reportDto(existing);
  return reportDto(
    await store.saveMaterialReport({
      pool: materialPool('verifier'),
      owner,
      requestId: request.id,
      planHash: materialPlanHash(plan),
      plan,
      attestation: body.attestation,
      assertAttestationAt: (savedPlan, savedAttestation, receivedAt) => {
        verifyMaterialAttestation({
          envelope: savedAttestation,
          plan: savedPlan,
          trustedVerifiers: materialKeyring(process.env),
          now: new Date(receivedAt),
        });
      },
    }),
  );
}

/** Separate transactional stages are replayable. A failure cannot publish a Signal. */
export async function confirmMaterialRegistration(owner: string, input: unknown) {
  requireMaterialWrites(process.env);
  const body = exact(input, ['requestId', 'reportId', 'planHash', 'consent']);
  if (body.consent !== true) fail('invalid_request');
  const { request, report, plan } = await checkedReport(
    owner,
    uuid(body.requestId),
    uuid(body.reportId),
  );
  if (report.plan_hash !== hash(body.planHash)) fail('material_changed');
  for (const stage of ['registered', 'verified'] as const) {
    const client = await materialPool(stage === 'registered' ? 'registrar' : 'verifier').connect();
    let committing = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [request.run_id]);
      // global catalog mutation lock prevents cross-candidate create/name races.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('material-registration:catalog',0))",
      );
      const live = (
        await client.query(
          'SELECT id,owner_id,status,deleted_at,snapshot,source_hash,result FROM public.signal_generation_runs WHERE id=$1 AND owner_id=$2',
          [request.run_id, owner],
        )
      ).rows[0];
      if (
        !live ||
        buildCandidateReview(live, request.candidate_index).materialHash !==
          request.base_material_hash
      )
        fail('material_changed');
      await client.query('SELECT public.hzense_lock_material_dependencies($1::uuid,$2::text)', [
        report.id,
        owner,
      ]);
      if (stage === 'registered') await registerMaterialPlan({ client, plan });
      else await verifyRegisteredMaterialPlan({ client, plan });
      await client.query(
        `INSERT INTO public.candidate_material_receipts(id,request_id,report_id,owner_id,plan_hash,stage)
        SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS(SELECT 1 FROM public.candidate_material_receipts WHERE report_id=$3 AND stage=$6)`,
        [randomUUID(), request.id, report.id, owner, report.plan_hash, stage],
      );
      committing = true;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (committing) fail('commit_unknown');
      throw e;
    } finally {
      client.release();
    }
  }
  return { registered: true, verified: true, canPublish: false };
}

export async function registeredMaterialForCandidate(
  owner: string,
  runId: string,
  candidateIndex: number,
  baseMaterialHash: string,
) {
  if (!materialRegistrationConfigured()) return null;
  const latest = await store.latestVerifiedMaterialReport({
    pool: materialPool('registrar'),
    owner,
    runId,
    candidateIndex,
    baseMaterialHash,
  });
  return latest ? (await checkedReport(owner, latest.request.id, latest.report.id)).plan : null;
}

export async function materialWorkerInbox(after?: string) {
  requireMaterialWrites(process.env);
  const client = await materialPool('verifier').connect();
  try {
    if (
      after &&
      !(
        await client.query('SELECT id FROM public.candidate_material_requests WHERE id=$1::uuid', [
          uuid(after),
        ])
      ).rows.length
    )
      fail('not_found');
    const rows = (
      await client.query(
        `SELECT r.id,r.owner_id FROM public.candidate_material_requests r
    JOIN public.signal_generation_runs g ON g.id=r.run_id AND g.owner_id=r.owner_id
    WHERE g.deleted_at IS NULL AND g.status='completed' AND NOT EXISTS(SELECT 1 FROM public.candidate_material_reports p WHERE p.request_id=r.id)
      AND ($1::uuid IS NULL OR (r.created_at,r.id) > (SELECT created_at,id FROM public.candidate_material_requests WHERE id=$1::uuid))
    ORDER BY r.created_at,r.id LIMIT 10`,
        [after ?? null],
      )
    ).rows;
    return { requests: rows, nextCursor: rows.length === 10 ? rows.at(-1)!.id : null };
  } finally {
    client.release();
  }
}
export async function materialWorkerRequest(owner: string, id: string) {
  requireMaterialWrites(process.env);
  const request = await store.getMaterialRequest({
    pool: materialPool('verifier'),
    owner,
    id: uuid(id),
  });
  const { run, review } = await packet(owner, request.run_id, request.candidate_index);
  if (review.materialHash !== request.base_material_hash) fail('material_changed');
  const client = await materialPool('verifier').connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const topics = (
      await client.query(
        "SELECT id,title FROM public.topics WHERE runtime_enabled IS TRUE AND status<>'archived' ORDER BY id LIMIT 1001",
      )
    ).rows;
    const entities = (
      await client.query(
        'SELECT id,type,name,aliases,status FROM public.entities ORDER BY id LIMIT 1001',
      )
    ).rows;
    const sources = (
      await client.query(
        'SELECT id,name,url,allowed_hosts,active FROM public.sources ORDER BY id LIMIT 1001',
      )
    ).rows;
    if ([topics, entities, sources].some((rows) => rows.length > 1000)) fail('catalog_limit');
    await client.query('COMMIT');
    return {
      requestId: request.id,
      owner,
      runId: request.run_id,
      candidateIndex: request.candidate_index,
      baseMaterialHash: request.base_material_hash,
      bundle: request.bundle,
      candidate: review.candidate,
      // Optional context for proposal preparation; accepting a report that
      // actually uses this URL still performs the strict current-source check.
      originalSourceUrl: await originalSourceUrl(owner, run).catch(() => null),
      catalog: { topics, entities, sources },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
