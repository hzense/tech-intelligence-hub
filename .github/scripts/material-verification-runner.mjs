import { mkdtemp, writeFile, readFile, unlink, rmdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import { fetchImportURL } from '../../apps/web/lib/import-fetch.ts';
import { MATERIAL_WORKER_PACKET_LIMIT_BYTES } from '../../apps/web/lib/material-worker-packet.ts';
import { importParserSource } from '../../packages/ingestion/src/import-parser-source.mjs';
import { parseImportOutput } from '../../packages/ingestion/src/import-task-contract.mjs';
import {
  assessMaterialVerification,
  signMaterialVerification,
  materialReviewDossierHash,
} from '../../packages/database/src/material-verification-worker.mjs';

const endpoint = 'https://hzense.com/api/internal/material-verification';
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const ownerId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  value === value.trim() &&
  ![...value].some((c) => c.codePointAt(0) < 32 || c.codePointAt(0) === 127);

/** Only this exact first-party endpoint ever receives the service token. */
export function materialAPI(token, fetcher = globalThis.fetch) {
  if (typeof token !== 'string' || token.length < 32 || /[\r\n]/.test(token))
    fail('not_configured');
  return async (action, request) => {
    if (!['inbox', 'read', 'report'].includes(action)) fail('invalid_request');
    if (
      action === 'inbox' &&
      (!request ||
        Object.keys(request).some((key) => key !== 'after') ||
        (request.after !== undefined && !uuid(request.after)))
    )
      fail('invalid_request');
    let response;
    try {
      response = await fetcher(
        action === 'inbox' && request.after ? `${endpoint}?after=${request.after}` : endpoint,
        {
          method: action === 'inbox' ? 'GET' : 'POST',
          redirect: 'error',
          signal: globalThis.AbortSignal.timeout(15000),
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(action === 'inbox' ? {} : { body: JSON.stringify({ action, request }) }),
        },
      );
      if (action === 'read' && response.status === 413) fail('material_worker_packet_too_large');
      if (
        !response.ok ||
        response.headers.get('content-type')?.split(';')[0] !== 'application/json'
      )
        fail('service_unavailable');
      const reader = response.body?.getReader();
      if (!reader) fail('service_unavailable');
      const chunks = [];
      let length = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > MATERIAL_WORKER_PACKET_LIMIT_BYTES)
            fail(action === 'read' ? 'material_worker_packet_too_large' : 'service_unavailable');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (action === 'read' && error?.code === 'material_worker_packet_too_large')
        fail('material_worker_packet_too_large');
      fail(action === 'report' ? 'submission_unknown' : 'service_unavailable');
    }
  };
}

/** Parser is trusted code; fetched documents are data. No signing/service secrets
 * reach the child. Only stdlib text/HTML formats are enabled in this runner. */
export async function readLiveMaterialSource(sourceUrl, dependencies = {}) {
  const receipt = await (dependencies.fetchURL ?? fetchImportURL)(sourceUrl, undefined, {
    allowRedirects: false,
  });
  if (
    !['html', 'text', 'markdown'].includes(receipt.format) ||
    receipt.bytes.length > 2 * 1024 * 1024
  )
    fail('source_unavailable');
  const directory = await mkdtemp(join(tmpdir(), 'hzense-material-'));
  const input = join(directory, 'input'),
    output = join(directory, 'output');
  try {
    await writeFile(input, receipt.bytes, { mode: 0o600, flag: 'wx' });
    await new Promise((resolve, reject) => {
      const child = (dependencies.spawnProcess ?? spawn)(
        'python3',
        ['-I', '-c', importParserSource, input, receipt.format, output],
        {
          env: { PATH: '/usr/bin:/bin' },
          cwd: directory,
          stdio: 'ignore',
          timeout: 15000,
        },
      );
      child.once('error', () => reject(new Error('source_unavailable')));
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('source_unavailable')),
      );
    });
    if ((await stat(output)).size > 4 * 1024 * 1024) fail('source_unavailable');
    const parsed = parseImportOutput(JSON.parse(await readFile(output, 'utf8')).output);
    return {
      sourceUrl,
      text: parsed.fragments.map((part) => part.text).join('\n\n'),
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    await unlink(input).catch(() => {});
    await unlink(output).catch(() => {});
    await rmdir(directory).catch(() => {});
  }
}

/** One UI-approved immutable proposal per invocation. No inbox drain,
 * no model calls, no auto retry and no publication capability. */
export async function executeReviewedMaterial(env, deps = {}) {
  if (env.HZENSE_MATERIAL_EXECUTOR_ENABLED !== '1') fail('not_configured');
  const requestId = env.MATERIAL_REQUEST_ID,
    approvalId = env.MATERIAL_APPROVAL_ID;
  if (!uuid(requestId) || !uuid(approvalId)) fail('invalid_request');
  const api = deps.api ?? materialAPI(env.HZENSE_MATERIAL_WORKER_TOKEN);
  // Dispatch identifies one request and its exact immutable approval UUID. Owner,
  // plan and approval provenance come only from the authenticated first-party API.
  let owner, after;
  const seenCursors = new Set(),
    seenRequests = new Set();
  for (let page = 0; page < 100; page++) {
    const inbox = await api('inbox', after ? { after } : {});
    if (
      !inbox ||
      !Array.isArray(inbox.requests) ||
      inbox.requests.length > 10 ||
      !(inbox.nextCursor === null || uuid(inbox.nextCursor)) ||
      (inbox.nextCursor !== null &&
        (inbox.requests.length !== 10 || inbox.requests.at(-1)?.id !== inbox.nextCursor))
    )
      fail('service_unavailable');
    for (const row of inbox.requests) {
      if (!uuid(row.id) || !ownerId(row.owner_id) || seenRequests.has(row.id))
        fail('service_unavailable');
      seenRequests.add(row.id);
      if (row.id === requestId) owner = row.owner_id;
    }
    if (owner) break;
    if (inbox.nextCursor === null) fail('request_not_found');
    if (seenCursors.has(inbox.nextCursor)) fail('service_unavailable');
    seenCursors.add(inbox.nextCursor);
    after = inbox.nextCursor;
  }
  if (!owner) fail('request_not_found');
  const read = async () => {
    const packet = await api('read', { owner, requestId });
    if (packet?.requestId !== requestId || packet?.owner !== owner) fail('request_changed');
    return packet;
  };
  const request = await read();
  const proposal = request.approvedProposal;
  if (
    !proposal ||
    !uuid(proposal.id) ||
    !uuid(proposal.approvalId) ||
    proposal.approvalId !== approvalId ||
    !/^[a-f0-9]{64}$/.test(proposal.proposalHash ?? '') ||
    !proposal.dossier ||
    proposal.dossier.approvedBy !== owner ||
    proposal.dossier.approvedAt !== proposal.approvedAt
  )
    fail('approval_required');
  // This approval is supplied by the trusted backend after checking its immutable
  // owner-scoped approval row. The browser/workflow cannot submit a dossier.
  const approvedDossierHash = materialReviewDossierHash(proposal.dossier);
  const assessment = await assessMaterialVerification({
    request,
    plan: proposal.plan,
    dossier: proposal.dossier,
    fetchSource: deps.fetchSource ?? readLiveMaterialSource,
    clock: deps.now ?? (() => new Date()),
  });
  // Re-read immediately before signing: cancelled/deleted/changed candidates or
  // catalog changes must not inherit a previously prepared approval.
  const current = await read();
  if (current.approvedProposal?.approvalId !== approvalId || !isDeepStrictEqual(current, request))
    fail('request_changed');
  const attestation = signMaterialVerification({
    assessment,
    approvedDossierHash,
    keyId: env.HZENSE_MATERIAL_SIGNING_KEY_ID,
    verifierId: env.HZENSE_MATERIAL_VERIFIER_ID,
    privateKey: env.HZENSE_MATERIAL_SIGNING_PRIVATE_KEY,
    now: deps.now?.() ?? new Date(),
    ttlMs: 60000,
  });
  const report = await api('report', {
    owner,
    requestId,
    plan: proposal.plan,
    attestation,
  });
  if (
    !report ||
    report.planHash !== assessment.planHash ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(report.id ?? '')
  )
    fail('submission_unknown');
  return { status: 'report_saved', requestId, planHash: report.planHash, reportId: report.id };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  executeReviewedMaterial(process.env).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      // Never print raw exceptions, source text, input, key or provider output.
      const code = [
        'submission_unknown',
        'not_configured',
        'invalid_request',
        'approval_required',
        'request_not_found',
        'request_changed',
        'service_unavailable',
      ].includes(error?.code)
        ? error.code
        : 'material_verification_failed';
      process.stdout.write(`${JSON.stringify({ status: 'blocked', code })}\n`);
      process.exitCode = 1;
    },
  );
}
