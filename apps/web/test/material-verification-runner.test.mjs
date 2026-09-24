import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { URL } from 'node:url';
import { readFile, writeFile, access } from 'node:fs/promises';
import { buildCandidateSourceBundle } from '../../../packages/ingestion/src/candidate-source-bundle.mjs';
import {
  materialPlanHash,
  verifyMaterialAttestation,
} from '../../../packages/database/src/material-registration-contract.mjs';
import {
  executeReviewedMaterial,
  materialAPI,
  readLiveMaterialSource,
} from '../../../.github/scripts/material-verification-runner.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const uuid = (number) => `11111111-1111-4111-8111-${number.toString(16).padStart(12, '0')}`;
const now = new Date('2026-09-24T10:00:00.000Z');
const sourceUrl = 'https://example.com/news';
const excerpt = 'Ada researcher announced X on 2026-09-24.';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const env = {
  HZENSE_MATERIAL_EXECUTOR_ENABLED: '1',
  MATERIAL_REQUEST_ID: uuid(1),
  MATERIAL_APPROVAL_ID: uuid(4),
  HZENSE_MATERIAL_WORKER_TOKEN: 'T'.repeat(40),
  HZENSE_MATERIAL_SIGNING_KEY_ID: 'trusted',
  HZENSE_MATERIAL_VERIFIER_ID: 'protected-runner',
  HZENSE_MATERIAL_SIGNING_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
function fixture() {
  const bundle = buildCandidateSourceBundle({
    baseMaterialHash: 'a'.repeat(64),
    source: {
      classification: 'private',
      fragments: [{ id: 'fragment-1', text: excerpt, locator: { paragraph: 1 } }],
    },
    supplements: [],
  });
  const plan = {
    version: 'material-registration-v1',
    owner: 'private-owner',
    runId: uuid(2),
    candidateIndex: 0,
    baseMaterialHash: bundle.baseMaterialHash,
    sourceBundleHash: bundle.sourceBundleHash,
    entities: [{ id: 'ada', type: 'person', name: 'Ada', aliases: [], evidenceIds: ['e1'] }],
    sources: [{ id: 's1', name: 'Example', url: sourceUrl, allowedHosts: ['example.com'] }],
    evidence: [
      {
        id: 'e1',
        sourceId: 's1',
        sourceUrl,
        locator: 'paragraph 1',
        excerpt,
        contentHash: sha(excerpt),
        capturedAt: now.toISOString(),
        sourcePublishedAt: null,
      },
    ],
    topicIds: ['ai'],
    candidate: {
      title: 'X announced',
      summary: 'Ada announced X.',
      eventDate: '2026-09-24',
      persons: [{ entityId: 'ada', role: 'researcher', organizationId: null, evidenceIds: ['e1'] }],
      organizationIds: [],
      claims: [{ text: 'X announced.', evidenceId: 'e1' }],
    },
  };
  const decision = { approved: true, rationale: 'Human reviewed this exact material.' };
  const dossier = {
    version: 'reviewed-material-dossier-v1',
    requestId: uuid(1),
    planHash: materialPlanHash(plan),
    sourceBundleHash: bundle.sourceBundleHash,
    approvedBy: 'private-owner',
    approvedAt: now.toISOString(),
    expiresAt: '2026-09-24T11:00:00.000Z',
    checks: Object.fromEntries(
      [
        'sourceAuthenticity',
        'usageRights',
        'entityIdentity',
        'eventRelevance',
        'claimSupport',
        'taxonomy',
      ].map((name) => [name, clone(decision)]),
    ),
    sources: [
      {
        sourceUrl,
        excerptHashes: [sha(excerpt)],
        authenticity: clone(decision),
        usageRights: { ...decision, basis: 'Explicit permission for this excerpt.' },
      },
    ],
    eventDate: {
      value: '2026-09-24',
      evidenceId: 'e1',
      quote: '2026-09-24',
      rationale: 'Explicit announcement date.',
    },
  };
  const packet = {
    requestId: uuid(1),
    owner: plan.owner,
    runId: plan.runId,
    candidateIndex: 0,
    baseMaterialHash: plan.baseMaterialHash,
    bundle,
    candidate: {
      title: plan.candidate.title,
      summary: plan.candidate.summary,
      event_date: plan.candidate.eventDate,
      persons: [{ name: 'Ada', role: 'researcher', organization: null }],
      organizations: [],
      claims: [{ text: 'X announced.' }],
    },
    originalSourceUrl: sourceUrl,
    catalog: { topics: [{ id: 'ai', title: 'AI' }], entities: [], sources: [] },
    approvedProposal: {
      id: uuid(3),
      proposalHash: 'b'.repeat(64),
      plan,
      dossier,
      approvedAt: now.toISOString(),
      approvalId: uuid(4),
    },
  };
  const calls = [];
  const api = async (action, request) => {
    calls.push({ action, request });
    if (action === 'inbox')
      return { requests: [{ id: uuid(1), owner_id: plan.owner }], nextCursor: null };
    if (action === 'read') return clone(packet);
    if (action === 'report') return { id: uuid(5), planHash: materialPlanHash(plan) };
    throw new Error('unexpected');
  };
  let sourceCalls = 0;
  return {
    packet,
    calls,
    api,
    now: () => now,
    fetchSource: async () => {
      sourceCalls++;
      return { sourceUrl, text: excerpt, fetchedAt: now.toISOString() };
    },
    sourceCalls: () => sourceCalls,
  };
}

test('one UI-approved request is live-checked, reread, signed and submitted exactly once', async () => {
  const f = fixture();
  const result = await executeReviewedMaterial(env, f);
  assert.deepEqual(
    f.calls.map((c) => c.action),
    ['inbox', 'read', 'read', 'report'],
  );
  assert.equal(f.sourceCalls(), 1);
  const sent = f.calls.at(-1).request;
  const verified = verifyMaterialAttestation({
    envelope: sent.attestation,
    plan: sent.plan,
    trustedVerifiers: {
      trusted: {
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
        verifierId: 'protected-runner',
      },
    },
    now,
  });
  assert.equal(verified.planHash, result.planHash);
  assert.deepEqual(result, {
    status: 'report_saved',
    requestId: uuid(1),
    planHash: materialPlanHash(f.packet.approvedProposal.plan),
    reportId: uuid(5),
  });
  assert.ok(!JSON.stringify(result).includes('private-owner'));
  assert.ok(!JSON.stringify(result).includes(excerpt));
});

test('dispatch requires exact request and approval UUIDs, never owner/plan/dossier inputs', async () => {
  for (const field of ['MATERIAL_REQUEST_ID', 'MATERIAL_APPROVAL_ID']) {
    for (const value of [undefined, '', sourceUrl, '{"owner":"attacker"}', `${uuid(1)}\n`]) {
      const f = fixture();
      await assert.rejects(executeReviewedMaterial({ ...env, [field]: value }, f), {
        code: 'invalid_request',
      });
      assert.equal(f.calls.length, 0);
    }
  }
  const f = fixture();
  await assert.rejects(
    executeReviewedMaterial({ ...env, HZENSE_MATERIAL_EXECUTOR_ENABLED: '0' }, f),
    { code: 'not_configured' },
  );
  assert.equal(f.calls.length, 0);
});

test('missing or wrong immutable owner approval is blocked before any public fetch or signing', async () => {
  for (const change of [
    (p) => {
      delete p.approvedProposal;
    },
    (p) => {
      p.approvedProposal.approvalId = 'bad';
    },
    (p) => {
      p.approvedProposal.approvalId = uuid(40);
    },
    (p) => {
      p.approvedProposal.id = 'bad';
    },
    (p) => {
      p.approvedProposal.proposalHash = 'bad';
    },
    (p) => {
      p.approvedProposal.dossier.approvedBy = 'different-owner';
    },
    (p) => {
      p.approvedProposal.approvedAt = '2026-09-24T09:59:00.000Z';
    },
  ]) {
    const f = fixture();
    change(f.packet);
    await assert.rejects(executeReviewedMaterial(env, f), { code: 'approval_required' });
    assert.equal(f.sourceCalls(), 0);
    assert.equal(
      f.calls.some((c) => c.action === 'report'),
      false,
    );
  }
});

test('a bare model true result does not substitute for the reviewed source permission', async () => {
  const f = fixture();
  delete f.packet.approvedProposal.dossier.sources[0].usageRights;
  await assert.rejects(executeReviewedMaterial(env, f));
  assert.equal(f.sourceCalls(), 0);
  assert.equal(
    f.calls.some((c) => c.action === 'report'),
    false,
  );
});

test('any candidate, catalog, proposal or approval change on final read prevents submission', async () => {
  for (const change of [
    (p) => {
      p.candidate.title = 'different';
    },
    (p) => {
      p.catalog.topics = [];
    },
    (p) => {
      p.approvedProposal.id = uuid(9);
    },
    (p) => {
      p.approvedProposal.proposalHash = 'c'.repeat(64);
    },
    (p) => {
      p.approvedProposal.approvalId = uuid(10);
    },
    (p) => {
      delete p.approvedProposal;
    },
  ]) {
    const f = fixture();
    let reads = 0;
    const original = f.api;
    f.api = async (action, value) => {
      const result = await original(action, value);
      if (action === 'read' && ++reads === 2) change(result);
      return result;
    };
    await assert.rejects(executeReviewedMaterial(env, f), { code: 'request_changed' });
    assert.equal(
      f.calls.some((c) => c.action === 'report'),
      false,
    );
  }
});

test('live source error or evidence mismatch never submits a report', async () => {
  for (const source of [
    async () => {
      throw new Error('secret upstream error');
    },
    async () => ({ sourceUrl, text: 'changed', fetchedAt: now.toISOString() }),
  ]) {
    const f = fixture();
    f.fetchSource = source;
    await assert.rejects(executeReviewedMaterial(env, f));
    assert.equal(
      f.calls.some((c) => c.action === 'report'),
      false,
    );
  }
});

test('unknown report outcome is not retried or replaced', async () => {
  const f = fixture(),
    original = f.api;
  let reports = 0;
  f.api = async (action, value) => {
    if (action === 'report') {
      reports++;
      throw Object.assign(new Error('submission_unknown'), { code: 'submission_unknown' });
    }
    return original(action, value);
  };
  await assert.rejects(executeReviewedMaterial(env, f), { code: 'submission_unknown' });
  assert.equal(reports, 1);
});

test('inbox uses bounded pagination and obtains owner only from target entry', async () => {
  const f = fixture(),
    original = f.api;
  let pages = 0;
  f.api = async (action, value) => {
    if (action === 'inbox' && ++pages === 1)
      return {
        requests: Array.from({ length: 10 }, (_, i) => ({
          id: uuid(20 + i),
          owner_id: 'other-owner',
        })),
        nextCursor: uuid(29),
      };
    if (action === 'inbox') assert.equal(value.after, uuid(29));
    return original(action, value);
  };
  await executeReviewedMaterial(env, f);
  assert.equal(pages, 2);
  assert.equal(f.calls.find((c) => c.action === 'read').request.owner, 'private-owner');
});

test('missing request, malformed inbox and cursor loops fail closed', async () => {
  for (const inbox of [
    { requests: [], nextCursor: null },
    { requests: [{ id: uuid(1), owner_id: '\ninvalid' }], nextCursor: null },
    {
      requests: [
        { id: uuid(1), owner_id: 'owner' },
        { id: uuid(1), owner_id: 'different' },
      ],
      nextCursor: null,
    },
    { requests: [], nextCursor: uuid(20) },
    {
      requests: Array.from({ length: 10 }, (_, i) => ({ id: uuid(20 + i), owner_id: 'other' })),
      nextCursor: uuid(29),
    },
  ]) {
    const f = fixture();
    let calls = 0;
    f.api = async () => {
      calls++;
      return inbox;
    };
    await assert.rejects(executeReviewedMaterial(env, f));
    assert.ok(calls <= 2);
    assert.equal(f.sourceCalls(), 0);
  }
});

test('at most 100 pages are visited and no whole-inbox processing occurs', async () => {
  const f = fixture();
  let pages = 0;
  f.api = async (action) => {
    assert.equal(action, 'inbox');
    const start = 100 + pages++ * 10;
    return {
      requests: Array.from({ length: 10 }, (_, i) => ({ id: uuid(start + i), owner_id: 'other' })),
      nextCursor: uuid(start + 9),
    };
  };
  await assert.rejects(executeReviewedMaterial(env, f), { code: 'request_not_found' });
  assert.equal(pages, 100);
});

test('service token only goes to exact production API with redirects forbidden', async () => {
  const calls = [];
  const api = materialAPI('S'.repeat(40), async (url, options) => {
    calls.push({ url, options });
    return new globalThis.Response('{}', { headers: { 'content-type': 'application/json' } });
  });
  await api('inbox', {});
  await api('inbox', { after: uuid(7) });
  await api('read', { owner: 'owner', requestId: uuid(1) });
  for (const { url, options } of calls) {
    assert.ok(url.startsWith('https://hzense.com/api/internal/material-verification'));
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${'S'.repeat(40)}`);
  }
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(
    calls[1].url,
    `https://hzense.com/api/internal/material-verification?after=${uuid(7)}`,
  );
  await assert.rejects(api('inbox', { after: sourceUrl }), { code: 'invalid_request' });
  await assert.rejects(api('fetch-private', {}), { code: 'invalid_request' });
  assert.equal(calls.length, 3);
});

test('API errors and oversized/malformed responses are redacted; report errors are outcome unknown', async () => {
  for (const response of [
    () => new globalThis.Response('secret', { status: 500 }),
    () => new globalThis.Response('not json', { headers: { 'content-type': 'application/json' } }),
    () => {
      throw new Error('secret token and upstream data');
    },
  ]) {
    const api = materialAPI('S'.repeat(40), async () => response());
    await assert.rejects(api('read', {}), {
      code: 'service_unavailable',
      message: 'service_unavailable',
    });
    await assert.rejects(api('report', {}), {
      code: 'submission_unknown',
      message: 'submission_unknown',
    });
  }
});

test('worker packet overflow is explicit, redacted, and never retried', async () => {
  for (const response of [
    () => new globalThis.Response('private detail', { status: 413 }),
    () =>
      new globalThis.Response('A'.repeat(2 * 1024 * 1024 + 1), {
        headers: { 'content-type': 'application/json' },
      }),
  ]) {
    let calls = 0;
    const api = materialAPI('S'.repeat(40), async () => {
      calls++;
      return response();
    });
    await assert.rejects(api('read', {}), {
      code: 'material_worker_packet_too_large',
      message: 'material_worker_packet_too_large',
    });
    assert.equal(calls, 1);
    await assert.rejects(api('report', {}), { code: 'submission_unknown' });
  }
});

test('live parser receives no signing/service secrets or full inherited environment', async () => {
  let optionsSeen, inputFile, outputFile;
  const result = await readLiveMaterialSource(sourceUrl, {
    fetchURL: async (url, _deps, options) => {
      assert.equal(url, sourceUrl);
      assert.deepEqual(options, { allowRedirects: false });
      return { bytes: Buffer.from(excerpt), format: 'text' };
    },
    spawnProcess: (command, args, options) => {
      assert.equal(command, 'python3');
      assert.equal(args[0], '-I');
      optionsSeen = options;
      inputFile = args.at(-3);
      outputFile = args.at(-1);
      const child = new EventEmitter();
      Promise.resolve()
        .then(async () => {
          assert.equal(await readFile(inputFile, 'utf8'), excerpt);
          await writeFile(
            outputFile,
            JSON.stringify({
              output: { fragments: [{ text: excerpt, locator: { paragraph: 1 } }], warnings: [] },
            }),
          );
          child.emit('exit', 0);
        })
        .catch((error) => child.emit('error', error));
      return child;
    },
  });
  assert.deepEqual(optionsSeen.env, { PATH: '/usr/bin:/bin' });
  assert.equal(optionsSeen.stdio, 'ignore');
  assert.equal(optionsSeen.timeout, 15000);
  assert.equal(result.sourceUrl, sourceUrl);
  assert.equal(result.text, excerpt);
  await assert.rejects(access(inputFile));
  await assert.rejects(access(outputFile));
  await assert.rejects(access(optionsSeen.cwd));
});

test('unsupported or oversized public source cannot reach parser', async () => {
  for (const receipt of [
    { bytes: Buffer.from('pdf'), format: 'pdf' },
    { bytes: Buffer.alloc(2 * 1024 * 1024 + 1), format: 'html' },
  ]) {
    await assert.rejects(
      readLiveMaterialSource(sourceUrl, {
        fetchURL: async () => receipt,
        spawnProcess: () => assert.fail('parser must not start'),
      }),
      { code: 'source_unavailable' },
    );
  }
});

test('workflow is manual, current-main CI gated, protected, one request only and no private artifacts', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/material-verification.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /request_id:/);
  assert.match(workflow, /approval_id:/);
  assert.match(workflow, /environment: material-verification/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /test "\$head" = "\$GITHUB_SHA"/);
  assert.match(workflow, /test "\$conclusion" = success/);
  assert.doesNotMatch(
    workflow,
    /pull_request_target|schedule:|input_sha256|REVIEWED_INPUT|upload-artifact|permissions:\s*write/,
  );
  assert.match(workflow, /MATERIAL_REQUEST_ID: \$\{\{ inputs\.request_id \}\}/);
  assert.match(workflow, /MATERIAL_APPROVAL_ID: \$\{\{ inputs\.approval_id \}\}/);
});
