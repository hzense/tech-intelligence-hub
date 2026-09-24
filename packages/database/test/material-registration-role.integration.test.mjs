import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import {
  assertMaterialRole,
  materialRoleProvisionSQL,
  materialProposalRoleProvisionSQL,
} from '../src/material-registration-role.mjs';
import { materialPlanHash } from '../src/material-registration-contract.mjs';
import {
  registerMaterialPlan,
  verifyRegisteredMaterialPlan,
} from '../src/material-registration-executor.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
suite('isolated PostgreSQL material registration roles and signed-stage boundaries', () => {
  const database = `hzense_material_acl_${randomUUID().replaceAll('-', '')}`;
  const roles = ['hzense_material_registrar', 'hzense_material_verifier'];
  const createdRoles = [];
  // Ephemeral test-only secret; never printed or persisted in a fixture.
  const password = randomBytes(32).toString('hex');
  const runId = randomUUID(),
    requestId = randomUUID(),
    reportId = randomUUID();
  const excerpt = 'Ada is a researcher at Lab.';
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const plan = {
    version: 'material-registration-v1',
    owner: 'test-owner',
    runId,
    candidateIndex: 0,
    baseMaterialHash: 'a'.repeat(64),
    sourceBundleHash: 'b'.repeat(64),
    entities: [
      { id: 'person-ada', type: 'person', name: 'Ada', aliases: [], evidenceIds: ['evidence-one'] },
      {
        id: 'institution-lab',
        type: 'institution',
        name: 'Lab',
        aliases: [],
        evidenceIds: ['evidence-one'],
      },
    ],
    sources: [
      {
        id: 'source-lab',
        name: 'Lab source',
        url: 'https://example.com/',
        allowedHosts: ['example.com'],
      },
    ],
    evidence: [
      {
        id: 'evidence-one',
        sourceId: 'source-lab',
        sourceUrl: 'https://example.com/announcement',
        locator: 'paragraph 1',
        excerpt,
        contentHash: digest(excerpt),
        capturedAt: '2026-09-24T10:00:00.000Z',
        sourcePublishedAt: null,
      },
    ],
    topicIds: ['topic-test'],
    candidate: {
      title: 'Announcement',
      summary: 'Ada announced research.',
      eventDate: '2026-09-24',
      persons: [
        {
          entityId: 'person-ada',
          role: 'researcher',
          organizationId: 'institution-lab',
          evidenceIds: ['evidence-one'],
        },
      ],
      organizationIds: ['institution-lab'],
      claims: [{ text: 'Ada works at Lab.', evidenceId: 'evidence-one' }],
    },
  };
  let admin,
    owner,
    createdDatabase = false;
  const roleClients = new Map();
  function connection(role) {
    const target = new URL(adminUrl);
    target.pathname = `/${database}`;
    if (role) {
      target.username = role;
      target.password = password;
    }
    return target.toString();
  }
  async function transaction(client, operation) {
    await client.query('BEGIN');
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('material-registration-test',0))",
      );
      await client.query('SELECT public.hzense_lock_material_dependencies($1::uuid,$2::text)', [
        reportId,
        plan.owner,
      ]);
      const result = await operation();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  const receipt = (client, stage) =>
    client.query(
      'INSERT INTO public.candidate_material_receipts(id,request_id,report_id,owner_id,plan_hash,stage) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), requestId, reportId, plan.owner, materialPlanHash(plan), stage],
    );
  const receiptOnce = (client, stage) =>
    client.query(
      `INSERT INTO public.candidate_material_receipts(id,request_id,report_id,owner_id,plan_hash,stage)
      SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS(SELECT 1 FROM public.candidate_material_receipts WHERE report_id=$3 AND stage=$6)`,
      [randomUUID(), requestId, reportId, plan.owner, materialPlanHash(plan), stage],
    );
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable cluster required');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    if (
      (await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])', [roles]))
        .rows.length
    )
      throw new Error('Refusing to modify existing material roles');
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    createdDatabase = true;
    owner = new pg.Client({ connectionString: connection() });
    await owner.connect();
    await runMigrations({ connectionString: connection() });
    await owner.query(`REVOKE TEMPORARY ON DATABASE "${database}" FROM PUBLIC`);
    await owner.query('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC');
    await owner.query(
      await readFile(
        new URL('../../../db/roles/create_material_registration_roles.sql', import.meta.url),
        'utf8',
      ),
    );
    createdRoles.push(...roles);
    for (const role of roles) await admin.query(`ALTER ROLE ${role} PASSWORD '${password}'`);
    await owner.query(materialRoleProvisionSQL());
    for (const role of roles) {
      const client = new pg.Client({ connectionString: connection(role) });
      await client.connect();
      roleClients.set(role, client);
    }
    await owner.query(
      "INSERT INTO public.topics(id,title,status,runtime_enabled) VALUES('topic-test','Test topic','active',true)",
    );
    await owner.query(
      `INSERT INTO public.signal_generation_runs(id,owner_id,batch_id,item_id,source_fence,source_hash,profile_id,profile_revision,generation_version,fingerprint,snapshot,configuration,status,result)
      VALUES($1,$2,$3,$4,1,$5,$6,1,'test',$5,'{}','{}','completed','{"classification":"private"}')`,
      [runId, plan.owner, randomUUID(), randomUUID(), plan.baseMaterialHash, randomUUID()],
    );
  }, 30000);
  afterAll(async () => {
    for (const client of roleClients.values()) await client.end();
    await owner?.end();
    if (createdDatabase) await admin.query(`DROP DATABASE "${database}"`);
    for (const role of createdRoles) await admin.query(`DROP ROLE ${role}`);
    await admin?.end();
  }, 30000);
  it('accepts exactly provisioned direct logins and rejects owner fallback or extra authority', async () => {
    for (const role of roles) await assertMaterialRole(roleClients.get(role), role);
    await expect(assertMaterialRole(owner, roles[0])).rejects.toThrow('not_configured');
    await owner.query(
      'GRANT UPDATE(verification_status) ON public.public_source_evidence TO hzense_material_registrar',
    );
    await expect(assertMaterialRole(roleClients.get(roles[0]), roles[0])).rejects.toThrow(
      'not_configured',
    );
    await owner.query(
      'REVOKE UPDATE(verification_status) ON public.public_source_evidence FROM hzense_material_registrar',
    );
    await assertMaterialRole(roleClients.get(roles[0]), roles[0]);
  });
  it('registers only pending evidence and admits only each role own receipt stage', async () => {
    const registrar = roleClients.get(roles[0]),
      verifier = roleClients.get(roles[1]);
    await registrar.query(
      `INSERT INTO public.candidate_material_requests(id,owner_id,run_id,candidate_index,base_material_hash,bundle_hash,fingerprint,bundle)
      VALUES($1,$2,$3,0,$4,$5,$4,'{}')`,
      [requestId, plan.owner, runId, plan.baseMaterialHash, plan.sourceBundleHash],
    );
    await verifier.query(
      `INSERT INTO public.candidate_material_reports(id,request_id,owner_id,plan_hash,plan,attestation)
      VALUES($1,$2,$3,$4,$5::jsonb,'{}')`,
      [reportId, requestId, plan.owner, materialPlanHash(plan), JSON.stringify(plan)],
    );
    await transaction(registrar, () => registerMaterialPlan({ client: registrar, plan }));
    expect(
      (
        await registrar.query(
          "SELECT verification_status FROM public.public_source_evidence WHERE id='evidence-one'",
        )
      ).rows[0].verification_status,
    ).toBe('pending');
    await expect(receipt(registrar, 'verified')).rejects.toMatchObject({ code: '42501' });
    await expect(receipt(verifier, 'registered')).rejects.toMatchObject({ code: '42501' });
    await expect(receipt(owner, 'verified')).rejects.toMatchObject({ code: '42501' });
    await receiptOnce(registrar, 'registered');
    await expect(
      registrar.query(
        "UPDATE public.public_source_evidence SET verification_status='verified' WHERE id='evidence-one'",
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      registrar.query(
        "INSERT INTO public.public_source_evidence(id,verification_status) VALUES('forged','verified')",
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      verifier.query(
        "INSERT INTO public.entities(id,type,name) VALUES('forged','person','Forged')",
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await transaction(verifier, async () => {
      await verifyRegisteredMaterialPlan({ client: verifier, plan });
      await receiptOnce(verifier, 'verified');
    });
    expect(
      (
        await verifier.query(
          "SELECT verification_status FROM public.public_source_evidence WHERE id='evidence-one'",
        )
      ).rows[0].verification_status,
    ).toBe('verified');
  });
  it('replays registration and verification without duplicates and rejects repeated stage receipts', async () => {
    const registrar = roleClients.get(roles[0]),
      verifier = roleClients.get(roles[1]);
    await transaction(registrar, () => registerMaterialPlan({ client: registrar, plan }));
    await transaction(verifier, () => verifyRegisteredMaterialPlan({ client: verifier, plan }));
    expect((await receiptOnce(registrar, 'registered')).rowCount).toBe(0);
    expect((await receiptOnce(verifier, 'verified')).rowCount).toBe(0);
    expect(
      (await registrar.query('SELECT id FROM public.public_source_evidence')).rows,
    ).toHaveLength(1);
    await expect(receipt(registrar, 'registered')).rejects.toMatchObject({ code: '23505' });
    await expect(receipt(verifier, 'verified')).rejects.toMatchObject({ code: '23505' });
    await expect(
      verifier.query(
        "UPDATE public.public_source_evidence SET excerpt='changed' WHERE id='evidence-one'",
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('detects disabled stage guard and altered evidence defaults before allowing service access', async () => {
    await owner.query(
      'ALTER TABLE public.candidate_material_receipts DISABLE TRIGGER candidate_material_receipts_insert_guard_trg',
    );
    await expect(assertMaterialRole(roleClients.get(roles[0]), roles[0])).rejects.toThrow(
      'not_configured',
    );
    await owner.query(
      'ALTER TABLE public.candidate_material_receipts ENABLE ALWAYS TRIGGER candidate_material_receipts_insert_guard_trg',
    );
    await owner.query(
      "ALTER TABLE public.public_source_evidence ALTER COLUMN verification_status SET DEFAULT 'verified'",
    );
    await expect(assertMaterialRole(roleClients.get(roles[0]), roles[0])).rejects.toThrow(
      'not_configured',
    );
    await owner.query(
      "ALTER TABLE public.public_source_evidence ALTER COLUMN verification_status SET DEFAULT 'pending'",
    );
    for (const role of roles) await assertMaterialRole(roleClients.get(role), role);
  });
  it('holds real dependency row locks against maintenance outside the advisory protocol', async () => {
    const registrar = roleClients.get(roles[0]);
    await registrar.query('BEGIN');
    try {
      await registrar.query('SELECT public.hzense_lock_material_dependencies($1::uuid,$2::text)', [
        reportId,
        plan.owner,
      ]);
      for (const sql of [
        "UPDATE public.sources SET active=false WHERE id='source-lab'",
        "UPDATE public.topics SET runtime_enabled=false WHERE id='topic-test'",
        "UPDATE public.entities SET status='archived' WHERE id='person-ada'",
        "UPDATE public.public_source_evidence SET verification_status='rejected' WHERE id='evidence-one'",
        "DELETE FROM public.person_profiles WHERE entity_id='person-ada'",
        "DELETE FROM public.organization_profiles WHERE entity_id='institution-lab'",
      ]) {
        await owner.query('BEGIN');
        try {
          await owner.query("SET LOCAL lock_timeout='100ms'");
          await expect(owner.query(sql)).rejects.toMatchObject({ code: '55P03' });
        } finally {
          await owner.query('ROLLBACK');
        }
      }
    } finally {
      await registrar.query('ROLLBACK');
    }
  });
  it('rejects caller/owner mismatch and oversized immutable report plans', async () => {
    const registrar = roleClients.get(roles[0]),
      verifier = roleClients.get(roles[1]);
    const lock = (client, id, principal) =>
      client.query('SELECT public.hzense_lock_material_dependencies($1::uuid,$2::text)', [
        id,
        principal,
      ]);
    await expect(lock(owner, reportId, plan.owner)).rejects.toMatchObject({ code: '42501' });
    await expect(lock(registrar, reportId, 'other-owner')).rejects.toMatchObject({ code: '22023' });
    await expect(lock(registrar, randomUUID(), plan.owner)).rejects.toMatchObject({
      code: '22023',
    });
    const oversized = { ...plan, sources: Array.from({ length: 9 }, () => plan.sources[0]) };
    const malformedId = randomUUID();
    await verifier.query(
      `INSERT INTO public.candidate_material_reports(id,request_id,owner_id,plan_hash,plan,attestation)
      VALUES($1,$2,$3,$4,$5::jsonb,'{}')`,
      [
        malformedId,
        requestId,
        plan.owner,
        digest(JSON.stringify(oversized)),
        JSON.stringify(oversized),
      ],
    );
    await expect(lock(registrar, malformedId, plan.owner)).rejects.toMatchObject({ code: '22023' });
  });
  it('separately extends proposal ACL without giving verifier approval writes or mutation authority', async () => {
    const registrar = roleClients.get(roles[0]),
      verifier = roleClients.get(roles[1]);
    await expect(assertMaterialRole(registrar, roles[0], { proposals: true })).rejects.toThrow(
      'not_configured',
    );
    await owner.query(materialProposalRoleProvisionSQL());
    await owner.query(materialProposalRoleProvisionSQL());
    for (const role of roles) {
      await assertMaterialRole(roleClients.get(role), role, { proposals: true });
      await expect(assertMaterialRole(roleClients.get(role), role)).rejects.toThrow(
        'not_configured',
      );
    }
    const proposalId = randomUUID(),
      proposalHash = 'c'.repeat(64);
    const insertProposal =
      'INSERT INTO public.candidate_material_proposals(id,request_id,owner_id,plan_hash,proposal_hash,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)';
    const values = [
      proposalId,
      requestId,
      plan.owner,
      materialPlanHash(plan),
      proposalHash,
      JSON.stringify({ plan, dossier: {} }),
    ];
    await expect(verifier.query(insertProposal, values)).rejects.toMatchObject({ code: '42501' });
    await expect(
      registrar.query(insertProposal, [randomUUID(), requestId, 'wrong-owner', ...values.slice(3)]),
    ).rejects.toMatchObject({ code: '23503' });
    await registrar.query(insertProposal, values);
    const insertApproval =
      'INSERT INTO public.candidate_material_approvals(id,proposal_id,request_id,owner_id,proposal_hash,approved_by) VALUES($1,$2,$3,$4,$5,$6)';
    const approval = [randomUUID(), proposalId, requestId, plan.owner, proposalHash, plan.owner];
    await expect(verifier.query(insertApproval, approval)).rejects.toMatchObject({ code: '42501' });
    await expect(
      registrar.query(insertApproval, [...approval.slice(0, 5), 'wrong-owner']),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      registrar.query(insertApproval, [...approval.slice(0, 4), 'd'.repeat(64), plan.owner]),
    ).rejects.toMatchObject({ code: '23503' });
    await registrar.query(insertApproval, approval);
    await expect(
      registrar.query(insertApproval, [randomUUID(), ...approval.slice(1)]),
    ).rejects.toMatchObject({ code: '23505' });
    expect(
      (await verifier.query('SELECT * FROM public.candidate_material_approvals')).rows,
    ).toHaveLength(1);
    for (const table of ['candidate_material_proposals', 'candidate_material_approvals']) {
      for (const sql of [
        `UPDATE public.${table} SET owner_id=owner_id`,
        `DELETE FROM public.${table}`,
        // Include referencing tables so PostgreSQL reaches our ALWAYS guard
        // instead of stopping earlier at its built-in foreign-key check.
        `TRUNCATE public.${table} CASCADE`,
      ]) {
        await expect(owner.query(sql)).rejects.toMatchObject({ code: '55000' });
        await expect(registrar.query(sql)).rejects.toMatchObject({ code: '42501' });
      }
    }
    await owner.query(
      'GRANT INSERT(id) ON public.candidate_material_approvals TO hzense_material_verifier',
    );
    await expect(assertMaterialRole(verifier, roles[1], { proposals: true })).rejects.toThrow(
      'not_configured',
    );
    await owner.query(
      'REVOKE INSERT(id) ON public.candidate_material_approvals FROM hzense_material_verifier',
    );
    await assertMaterialRole(verifier, roles[1], { proposals: true });
  });
});
