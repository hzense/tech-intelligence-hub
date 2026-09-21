import { readFile, readdir } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, it, describe, expect } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { fixture } from './candidate-review.test.mjs';
import { publicSignalSearchQuery } from '../../../apps/web/lib/public-signal-reader-core.ts';
import { saveCandidateReview } from '../src/candidate-review-store.mjs';
import {
  signalWriterInsertColumns,
  signalWriterSelectTables,
} from '../src/signal-writer-contract.mjs';
import {
  prepareReviewedSignalCandidate,
  readReviewedPublicationMaterial,
  recordReviewedVerification,
  assembleReviewedVerifiedCandidate,
  publishReviewedSignal,
  withdrawReviewedSignal,
  inspectReviewedCandidate,
} from '../src/candidate-review-publication.mjs';
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
suite('review conversion with isolated PostgreSQL roles and real publication', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const db = `hzense_reviewpub_${suffix}`;
  const roles = ['assembler', 'verifier', 'publisher'].map(
    (r) => `hzense_reviewpub_${r}_${suffix}`,
  );
  let admin,
    owner,
    assembler,
    verifier,
    publisher,
    created = false;
  const createdRoles = [];
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable cluster required');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = `/${db}`;
    owner = new pg.Pool({ connectionString: url.toString(), max: 6 });
    await owner.query('CREATE EXTENSION vector; REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await owner.query(`REVOKE CREATE,TEMPORARY ON DATABASE "${db}" FROM PUBLIC`);
    const migrations = new URL('../../../db/migrations/', import.meta.url);
    for (const file of (await readdir(migrations)).filter((f) => /^\d{4}.*\.sql$/.test(f)).sort())
      await owner.query(await readFile(new URL(file, migrations), 'utf8'));
    await owner.query(
      "CREATE TABLE public.hzense_schema_migrations(name text PRIMARY KEY); INSERT INTO public.hzense_schema_migrations VALUES('0012_current_signal_publication.sql')",
    );
    for (const role of roles) {
      await admin.query(
        `CREATE ROLE "${role}" LOGIN PASSWORD 'synthetic-test-only' NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`,
      );
      createdRoles.push(role);
      await owner.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    }
    const createPool = (role) => {
      const value = new URL(url);
      value.username = role;
      value.password = 'synthetic-test-only';
      return new pg.Pool({ connectionString: value.toString(), max: 2 });
    };
    assembler = createPool(roles[0]);
    verifier = createPool(roles[1]);
    publisher = createPool(roles[2]);
    const select = async (role, tables) =>
      owner.query(`GRANT SELECT ON ${tables.map((t) => `public.${t}`).join(',')} TO "${role}"`);
    await select(roles[0], [
      ...signalWriterSelectTables.filter((t) => t !== 'hzense_schema_migrations'),
      'signal_generation_runs',
      'candidate_reviews',
      'candidate_review_conversions',
    ]);
    for (const [table, columns] of Object.entries(signalWriterInsertColumns))
      if (table !== 'public_source_evidence')
        await owner.query(`GRANT INSERT(${columns.join(',')}) ON public.${table} TO "${roles[0]}"`);
    await owner.query(`GRANT INSERT ON public.candidate_review_conversions TO "${roles[0]}"`);
    await select(roles[1], [
      ...signalWriterSelectTables.filter((t) => t !== 'hzense_schema_migrations'),
      'signal_candidate_verifications',
      'signal_candidate_assembly_receipts',
      'candidate_review_attestations',
    ]);
    await owner.query(
      `GRANT INSERT ON public.signal_versions,public.signal_version_evidence,public.signal_version_people,public.signal_version_organizations,public.signal_version_topics,public.signal_candidate_verifications,public.signal_candidate_assembly_receipts,public.candidate_review_attestations TO "${roles[1]}"; GRANT EXECUTE ON FUNCTION public.hzense_lock_publication_dependencies(text,integer) TO "${roles[1]}"`,
    );
    await owner.query(
      `GRANT UPDATE(verification_id) ON public.signal_candidate_verifications TO "${roles[1]}"`,
    );
    // Existing production publisher grant contract, applied to an isolated test role.
    await owner.query(`REVOKE USAGE ON SCHEMA public FROM "${roles[2]}"`);
    const publisherSql = (
      await readFile(
        new URL('../../../db/roles/configure_signal_publisher.sql', import.meta.url),
        'utf8',
      )
    ).replaceAll('hzense_publisher', roles[2]);
    await owner.query(publisherSql);
  }, 30000);
  afterAll(async () => {
    await Promise.all([assembler?.end(), verifier?.end(), publisher?.end(), owner?.end()]);
    if (created) await admin.query(`DROP DATABASE "${db}"`);
    for (const role of createdRoles) await admin.query(`DROP ROLE "${role}"`);
    await admin?.end();
  });
  async function prepareFixture() {
    const { run, request } = fixture();
    await owner.query(
      `INSERT INTO public.signal_generation_runs(id,owner_id,batch_id,item_id,source_fence,source_hash,profile_id,profile_revision,generation_version,fingerprint,snapshot,configuration,status,result) VALUES($1,$2,$3,$4,1,$5,$6,1,'test',$5,$7,'{}','completed',$8)`,
      [
        run.id,
        run.owner_id,
        randomUUID(),
        randomUUID(),
        run.source_hash,
        randomUUID(),
        run.snapshot,
        run.result,
      ],
    );
    const id = `review-test-${randomUUID()}`;
    await owner.query(
      `INSERT INTO public.sources(id,name,type,trust_score,allowed_hosts) VALUES($1,'Synthetic source','website',80,ARRAY['example.com']);`,
      [`${id}-source`],
    );
    await owner.query(
      `INSERT INTO public.entities(id,name,type) VALUES($1,'Synthetic Person','person')`,
      [`${id}-person`],
    );
    await owner.query('INSERT INTO public.person_profiles(entity_id) VALUES($1)', [`${id}-person`]);
    await owner.query(
      `INSERT INTO public.topics(id,title,status,runtime_enabled) VALUES($1,'Synthetic','active',true)`,
      [`${id}-topic`],
    );
    await owner.query(
      `INSERT INTO public.public_source_evidence(id,source_id,source_url,locator,excerpt,content_hash,captured_at,verification_status) VALUES($1,$2,'https://example.com/event','paragraph 1','Synthetic public excerpt',$3,'2026-09-20T00:00:00.000Z','verified')`,
      [`${id}-evidence`, `${id}-source`, 'a'.repeat(64)],
    );
    const draft = {
      title: 'Synthetic reviewed event',
      summary: 'Synthetic summary',
      eventDate: '2026-09-20',
      eventKey: `${id}-event`,
      sourceUrls: ['https://example.com/event'],
      personIds: [`${id}-person`],
      organizationIds: [],
      topicIds: [`${id}-topic`],
      publicEvidenceIds: [`${id}-evidence`],
      claims: [
        { text: 'Synthetic claim pending factual verification', evidenceId: `${id}-evidence` },
      ],
    };
    const review = await saveCandidateReview({
      pool: owner,
      owner: 'owner',
      materialHash: request.materialHash,
      request: { ...request, decision: 'submit_verification', draft },
    });
    const identity = {
      runId: run.id,
      candidateIndex: 0,
      expectedReviewRevision: 1,
      materialHash: request.materialHash,
    };
    return { run, request, review, draft, identity };
  }
  it('converts exactly once, rejects foreign owners and duplicate event identities without public writes', async () => {
    const f = await prepareFixture();
    const args = {
      pool: assembler,
      owner: 'owner',
      request: { ...f.identity, requestKey: randomUUID() },
    };
    await expect(prepareReviewedSignalCandidate({ ...args, owner: 'other' })).rejects.toThrow(
      'not_found',
    );
    await owner.query(
      "UPDATE public.public_source_evidence SET verification_status='pending' WHERE id=$1",
      [f.draft.publicEvidenceIds[0]],
    );
    await expect(prepareReviewedSignalCandidate(args)).rejects.toThrow('public_evidence_required');
    expect(
      (await owner.query('SELECT * FROM public.signals WHERE id=$1', [`review-${f.review.id}`]))
        .rows,
    ).toEqual([]);
    await owner.query(
      "UPDATE public.public_source_evidence SET verification_status='verified' WHERE id=$1",
      [f.draft.publicEvidenceIds[0]],
    );
    const result = await prepareReviewedSignalCandidate(args);
    expect(result.outcome).toBe('prepared');
    expect((await prepareReviewedSignalCandidate(args)).outcome).toBe('replay');
    expect(
      (
        await owner.query(
          'SELECT verification_status FROM public.signal_version_people WHERE signal_id=$1',
          [result.signal_id],
        )
      ).rows[0].verification_status,
    ).toBe('pending');
    expect(
      (
        await owner.query('SELECT * FROM public.current_public_signals WHERE signal_id=$1', [
          result.signal_id,
        ])
      ).rows,
    ).toEqual([]);
    await expect(
      assembler.query('UPDATE public.entities SET name=$1 WHERE id=$2', [
        'bad',
        f.draft.personIds[0],
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      prepareReviewedSignalCandidate({
        ...args,
        request: { ...args.request, expectedReviewRevision: 2 },
      }),
    ).rejects.toThrow('revision_conflict');
    await saveCandidateReview({
      pool: owner,
      owner: 'owner',
      materialHash: f.request.materialHash,
      request: {
        ...f.request,
        requestId: randomUUID(),
        expectedRevision: 1,
        decision: 'submit_verification',
        draft: f.draft,
      },
    });
    await expect(
      prepareReviewedSignalCandidate({
        ...args,
        request: { ...args.request, expectedReviewRevision: 2, requestKey: randomUUID() },
      }),
    ).resolves.toMatchObject({ signal_id: result.signal_id, source_version: 2 });
    expect(
      (
        await owner.query(
          'SELECT version FROM public.signal_versions WHERE signal_id=$1 ORDER BY version',
          [result.signal_id],
        )
      ).rows,
    ).toEqual([{ version: 1 }, { version: 2 }]);
    const other = await prepareFixture();
    await saveCandidateReview({
      pool: owner,
      owner: 'owner',
      materialHash: other.request.materialHash,
      request: {
        ...other.request,
        requestId: randomUUID(),
        expectedRevision: 1,
        decision: 'submit_verification',
        draft: { ...other.draft, eventKey: f.draft.eventKey },
      },
    });
    await expect(
      prepareReviewedSignalCandidate({
        pool: assembler,
        owner: 'owner',
        request: { ...other.identity, expectedReviewRevision: 2, requestKey: randomUUID() },
      }),
    ).rejects.toThrow('event_already_exists');
  });
  it('requires trusted material-bound verification, assembles, publishes and withdraws even after a newer rejection', async () => {
    const f = await prepareFixture();
    const base = { pool: assembler, owner: 'owner', request: f.identity };
    const converted = await prepareReviewedSignalCandidate({
      ...base,
      request: { ...f.identity, requestKey: randomUUID() },
    });
    await expect(
      assembleReviewedVerifiedCandidate({
        ...base,
        verificationPool: verifier,
        request: { ...f.identity, requestKey: randomUUID(), verificationId: randomUUID() },
      }),
    ).rejects.toThrow('verification_not_found');
    const material = await readReviewedPublicationMaterial({ ...base, verificationPool: verifier });
    const report = {
      verification_id: randomUUID(),
      signal_id: converted.signal_id,
      source_version: 1,
      source_content_hash: material.bundle.snapshot.content_hash,
      bundle_fingerprint: material.bundle_fingerprint,
      verifier_id: randomUUID(),
      policy_version: 'candidate-verification-v1',
      decision: 'approved',
      checks: {
        claims_supported: true,
        people_disambiguated: true,
        people_are_participants: true,
        organizations_supported: true,
        public_sources_cleared: true,
        contradictions_resolved: true,
      },
      valid_for_seconds: 3600,
    };
    // Fixture represents an externally authenticated synthetic report. Signature adapter has separate tests.
    const attestation = {
      keyId: 'synthetic-key',
      payload: 'c3ludGhldGlj',
      signature: 'synthetic-signature',
    };
    await recordReviewedVerification({
      ...base,
      verificationPool: verifier,
      request: { ...f.identity, report, attestation },
    });
    expect(
      (
        await owner.query(
          'SELECT key_id FROM public.candidate_review_attestations WHERE verification_id=$1',
          [report.verification_id],
        )
      ).rows[0].key_id,
    ).toBe('synthetic-key');
    await expect(
      recordReviewedVerification({
        ...base,
        verificationPool: verifier,
        request: { ...f.identity, report, attestation: { ...attestation, payload: 'changed' } },
      }),
    ).rejects.toThrow('verification_key_reused');
    await assembleReviewedVerifiedCandidate({
      ...base,
      verificationPool: verifier,
      request: { ...f.identity, verificationId: report.verification_id, requestKey: randomUUID() },
    });
    await expect(
      verifier.query(
        'UPDATE public.signal_candidate_verifications SET verification_id=verification_id WHERE verification_id=$1',
        [report.verification_id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      verifier.query(
        "UPDATE public.signal_candidate_verifications SET decision='rejected' WHERE verification_id=$1",
        [report.verification_id],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      verifier.query(
        'UPDATE public.public_source_evidence SET verification_status=$1 WHERE id=$2',
        ['verified', f.draft.publicEvidenceIds[0]],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const taskId = randomUUID(),
      principalId = randomUUID();
    await owner.query('UPDATE public.signal_publication_control SET publication_enabled=true');
    await owner.query(
      "INSERT INTO public.signal_publication_tasks(task_id,policy,publication_enabled) VALUES($1,'auto_publish',true)",
      [taskId],
    );
    await owner.query(
      'INSERT INTO public.signal_publication_authorizations(task_id,principal_id,can_publish) VALUES($1,$2,true)',
      [taskId, principalId],
    );
    const publicationArgs = {
      ...base,
      publisherPool: publisher,
      controlPool: owner,
      trustedControl: { taskId, principalId },
      request: {
        ...f.identity,
        requestKey: randomUUID(),
        expectedPublicationRevision: 0,
        reasonCode: 'initial_publication',
      },
    };
    let dropped = false;
    const uncertainPublisher = {
      async connect() {
        const c = await publisher.connect();
        return {
          async query(sql, args) {
            const result = await c.query(sql, args);
            if (sql === 'COMMIT' && !dropped) {
              dropped = true;
              throw new Error('Synthetic lost COMMIT response');
            }
            return result;
          },
          release(error) {
            c.release(error);
          },
        };
      },
    };
    await expect(
      publishReviewedSignal({ ...publicationArgs, publisherPool: uncertainPublisher }),
    ).rejects.toThrow('database_unavailable');
    const published = await publishReviewedSignal(publicationArgs);
    expect(published).toMatchObject({ outcome: 'replay', current_public: true });
    expect(await publishReviewedSignal(publicationArgs)).toMatchObject({
      outcome: 'replay',
      current_public: true,
    });
    expect(
      (await owner.query(publicSignalSearchQuery, [['synthetic reviewed event'], 20])).rows.map(
        (r) => r.signal_id,
      ),
    ).toContain(converted.signal_id);
    await owner.query('UPDATE public.entities SET name=$1 WHERE id=$2', [
      'Changed synthetic identity',
      f.draft.personIds[0],
    ]);
    expect(
      (await owner.query(publicSignalSearchQuery, [['synthetic reviewed event'], 20])).rows,
    ).toEqual([]);
    await owner.query('UPDATE public.entities SET name=$1 WHERE id=$2', [
      'Synthetic Person',
      f.draft.personIds[0],
    ]);
    expect(
      (await owner.query(publicSignalSearchQuery, [['synthetic reviewed event'], 20])).rows,
    ).toEqual([]);
    expect(
      (
        await owner.query(
          'SELECT count(*)::int AS count FROM public.signal_publication_outbox WHERE signal_id=$1',
          [converted.signal_id],
        )
      ).rows[0].count,
    ).toBe(1);
    const revisedDraft = { ...f.draft, title: 'Synthetic corrected title' };
    await saveCandidateReview({
      pool: owner,
      owner: 'owner',
      materialHash: f.request.materialHash,
      request: {
        ...f.request,
        requestId: randomUUID(),
        expectedRevision: 1,
        decision: 'submit_verification',
        draft: revisedDraft,
      },
    });
    const revisedIdentity = { ...f.identity, expectedReviewRevision: 2 };
    const revised = await prepareReviewedSignalCandidate({
      ...base,
      request: { ...revisedIdentity, requestKey: randomUUID() },
    });
    expect(revised).toMatchObject({ signal_id: converted.signal_id, source_version: 4 });
    await expect(publishReviewedSignal(publicationArgs)).rejects.toThrow('revision_conflict');
    await expect(
      assembleReviewedVerifiedCandidate({
        ...base,
        verificationPool: verifier,
        request: {
          ...revisedIdentity,
          verificationId: report.verification_id,
          requestKey: randomUUID(),
        },
      }),
    ).rejects.toThrow('verification_already_consumed');
    const revisedMaterial = await readReviewedPublicationMaterial({
      ...base,
      verificationPool: verifier,
      request: revisedIdentity,
    });
    const revisedReport = {
      ...report,
      verification_id: randomUUID(),
      source_version: 4,
      source_content_hash: revisedMaterial.bundle.snapshot.content_hash,
      bundle_fingerprint: revisedMaterial.bundle_fingerprint,
    };
    await recordReviewedVerification({
      ...base,
      verificationPool: verifier,
      request: { ...revisedIdentity, report: revisedReport, attestation },
    });
    await assembleReviewedVerifiedCandidate({
      ...base,
      verificationPool: verifier,
      request: {
        ...revisedIdentity,
        verificationId: revisedReport.verification_id,
        requestKey: randomUUID(),
      },
    });
    const correction = await publishReviewedSignal({
      ...publicationArgs,
      request: {
        ...revisedIdentity,
        requestKey: randomUUID(),
        expectedPublicationRevision: 1,
        reasonCode: 'content_correction',
      },
    });
    expect(correction).toMatchObject({
      outcome: 'apply',
      publication_revision: 2,
      content_version: 6,
      current_public: true,
    });
    expect(
      (await owner.query(publicSignalSearchQuery, [['synthetic corrected title'], 20])).rows.map(
        (r) => r.signal_id,
      ),
    ).toContain(converted.signal_id);
    expect(
      (
        await owner.query(
          'SELECT title FROM public.signal_versions WHERE signal_id=$1 AND version IN (1,4) ORDER BY version',
          [converted.signal_id],
        )
      ).rows,
    ).toEqual([{ title: f.draft.title }, { title: revisedDraft.title }]);
    await saveCandidateReview({
      pool: owner,
      owner: 'owner',
      materialHash: f.request.materialHash,
      request: {
        ...f.request,
        requestId: randomUUID(),
        expectedRevision: 2,
        decision: 'rejected',
        draft: f.draft,
      },
    });
    const withdrawn = await withdrawReviewedSignal({
      ...base,
      publisherPool: publisher,
      request: {
        ...revisedIdentity,
        requestKey: randomUUID(),
        expectedPublicationRevision: 2,
        reasonCode: 'operator_request',
      },
    });
    expect(withdrawn).toMatchObject({ outcome: 'apply', current_public: false });
    expect(
      await inspectReviewedCandidate({
        ...base,
        verificationPool: verifier,
        publisherPool: publisher,
        request: revisedIdentity,
      }),
    ).toMatchObject({
      reviewRevision: 2,
      publication: { status: 'withdrawn', publication_revision: 3 },
      readiness: 'not_currently_public',
    });
    expect(
      await inspectReviewedCandidate({
        ...base,
        request: { ...f.identity, expectedReviewRevision: 3 },
      }),
    ).toMatchObject({ reviewRevision: 3, conversion: null, readiness: 'review_not_submitted' });
    expect(
      (await owner.query(publicSignalSearchQuery, [['synthetic corrected title'], 20])).rows,
    ).toEqual([]);
    expect(
      (
        await owner.query('SELECT * FROM public.current_public_signals WHERE signal_id=$1', [
          converted.signal_id,
        ])
      ).rows,
    ).toEqual([]);
  });
  it('requires a new review and independent verification to republish a withdrawn assembly', async () => {
    const f = await prepareFixture();
    const base = { pool: assembler, owner: 'owner', request: f.identity };
    const converted = await prepareReviewedSignalCandidate({
      ...base,
      request: { ...f.identity, requestKey: randomUUID() },
    });
    const material = await readReviewedPublicationMaterial({ ...base, verificationPool: verifier });
    const report = {
      verification_id: randomUUID(),
      signal_id: converted.signal_id,
      source_version: 1,
      source_content_hash: material.bundle.snapshot.content_hash,
      bundle_fingerprint: material.bundle_fingerprint,
      verifier_id: randomUUID(),
      policy_version: 'candidate-verification-v1',
      decision: 'approved',
      checks: {
        claims_supported: true,
        people_disambiguated: true,
        people_are_participants: true,
        organizations_supported: true,
        public_sources_cleared: true,
        contradictions_resolved: true,
      },
      valid_for_seconds: 3600,
    };
    await recordReviewedVerification({
      ...base,
      verificationPool: verifier,
      request: {
        ...f.identity,
        report,
        attestation: { keyId: 'synthetic', payload: 'c3ludGhldGlj', signature: 'synthetic' },
      },
    });
    await assembleReviewedVerifiedCandidate({
      ...base,
      verificationPool: verifier,
      request: { ...f.identity, requestKey: randomUUID(), verificationId: report.verification_id },
    });
    const taskId = randomUUID(),
      principalId = randomUUID();
    await owner.query('UPDATE public.signal_publication_control SET publication_enabled=true');
    await owner.query(
      "INSERT INTO public.signal_publication_tasks(task_id,policy,publication_enabled) VALUES($1,'auto_publish',true)",
      [taskId],
    );
    await owner.query(
      'INSERT INTO public.signal_publication_authorizations(task_id,principal_id,can_publish) VALUES($1,$2,true)',
      [taskId, principalId],
    );
    const args = {
      ...base,
      publisherPool: publisher,
      controlPool: owner,
      trustedControl: { taskId, principalId },
    };
    await publishReviewedSignal({
      ...args,
      request: {
        ...f.identity,
        requestKey: randomUUID(),
        expectedPublicationRevision: 0,
        reasonCode: 'initial_publication',
      },
    });
    await withdrawReviewedSignal({
      ...base,
      publisherPool: publisher,
      request: {
        ...f.identity,
        requestKey: randomUUID(),
        expectedPublicationRevision: 1,
        reasonCode: 'operator_request',
      },
    });
    await expect(
      publishReviewedSignal({
        ...args,
        request: {
          ...f.identity,
          requestKey: randomUUID(),
          expectedPublicationRevision: 2,
          reasonCode: 'republication',
        },
      }),
    ).rejects.toThrow('review_revision_required');
    expect(
      (
        await owner.query(
          'SELECT count(*)::int AS count FROM public.signal_publication_outbox WHERE signal_id=$1',
          [converted.signal_id],
        )
      ).rows[0].count,
    ).toBe(2);
  });
});
