import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { assertAutomationRole } from '../src/automation-role.mjs';
import {
  saveAutomationConfig,
  enqueueAutomation,
  claimAutomationRun,
  beginSourceDiscovery,
  updateAutomationRun,
  readCollectedSourceUrls,
  readAutomationRun,
} from '../src/automation-store.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const database = `hzense_automation_${randomUUID().replaceAll('-', '')}`;
const roleNames = ['hzense_automation_admin', 'hzense_insight_reader'];
const password = 'isolated-automation-fixture-only';
const sql = (name) => readFile(new URL(`../../../db/${name}`, import.meta.url), 'utf8');

suite('automation role isolation and publication boundary', () => {
  let administrator;
  let owner;
  let adminRole;
  let readerRole;
  let created = false;
  let rolesCreated = false;
  const ambient = [];

  function url(role) {
    const value = new URL(adminUrl);
    value.pathname = `/${database}`;
    if (role) {
      value.username = role;
      value.password = password;
    }
    return value.toString();
  }

  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable PostgreSQL cluster required');
    administrator = new pg.Client({ connectionString: adminUrl });
    await administrator.connect();
    if (
      (
        await administrator.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])', [
          roleNames,
        ])
      ).rows.length
    )
      throw new Error('Automation role already exists in the test cluster');
    const otherDatabases = (
      await administrator.query(
        "SELECT datname FROM pg_database WHERE datallowconn AND datname NOT IN ('postgres','template1')",
      )
    ).rows;
    if (otherDatabases.length) throw new Error('Refuse cluster containing unrelated databases');
    for (const name of ['postgres', 'template1']) {
      const privileges = (
        await administrator.query(
          "SELECT a.privilege_type FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=$1 AND a.grantee=0",
          [name],
        )
      ).rows.map((row) => row.privilege_type);
      ambient.push({ name, privileges });
      await administrator.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    }
    await administrator.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    owner = new pg.Client({ connectionString: url() });
    await owner.connect();
    await owner.query('CREATE TABLE public.hzense_schema_migrations(name text PRIMARY KEY)');
    await owner.query(await sql('migrations/0026_automation_tasks.sql'));
    await owner.query(
      "INSERT INTO public.hzense_schema_migrations VALUES('0026_automation_tasks.sql')",
    );
    await owner.query(`REVOKE CREATE,TEMPORARY ON DATABASE "${database}" FROM PUBLIC`);
    await owner.query('REVOKE USAGE ON SCHEMA public FROM PUBLIC');
    await owner.query(await sql('roles/create_automation_roles.sql'));
    rolesCreated = true;
    for (const role of roleNames)
      await administrator.query(`ALTER ROLE ${role} PASSWORD '${password}'`);
    await owner.query(await sql('roles/configure_automation_roles.sql'));
    adminRole = new pg.Client({ connectionString: url(roleNames[0]) });
    readerRole = new pg.Client({ connectionString: url(roleNames[1]) });
    await adminRole.connect();
    await readerRole.connect();
  }, 30_000);

  afterAll(async () => {
    await adminRole?.end();
    await readerRole?.end();
    await owner?.end();
    if (created) await administrator.query(`DROP DATABASE "${database}"`);
    if (rolesCreated) for (const role of roleNames) await administrator.query(`DROP ROLE ${role}`);
    for (const { name, privileges } of ambient) {
      if (privileges.length)
        await administrator.query(`GRANT ${privileges.join(',')} ON DATABASE "${name}" TO PUBLIC`);
    }
    await administrator?.end();
  }, 30_000);

  it('admits only the exact private admin and filtered public reader capabilities', async () => {
    await assertAutomationRole(adminRole, 'admin');
    await assertAutomationRole(readerRole, 'reader');
    await expect(readerRole.query('SELECT * FROM public.automation_runs')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(readerRole.query('SELECT * FROM public.automation_configs')).rejects.toMatchObject(
      { code: '42501' },
    );
    await expect(
      adminRole.query('SELECT * FROM public.published_topic_insights'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(adminRole.query('DELETE FROM public.automation_runs')).rejects.toMatchObject({
      code: '42501',
    });
    const configId = randomUUID();
    await adminRole.query(
      "INSERT INTO public.automation_configs(id,owner_id,revision,config,enabled) VALUES($1,'test-owner',1,'{}',false)",
      [configId],
    );
    const privateId = randomUUID();
    const publishedId = randomUUID();
    await adminRole.query(
      "INSERT INTO public.automation_runs(id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase,result,publication_status) VALUES($1,$2,'test-owner',1,'{\"kind\":\"topic_insight\"}', $3,'manual','completed','completed','{}',$4)",
      [privateId, configId, 'manual:private', 'private'],
    );
    await adminRole.query(
      "INSERT INTO public.automation_runs(id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase,result,publication_status) VALUES($1,$2,'test-owner',1,'{\"kind\":\"topic_insight\"}', $3,'manual','completed','completed','{}',$4)",
      [publishedId, configId, 'manual:published', 'published'],
    );
    expect((await readerRole.query('SELECT id FROM public.published_topic_insights')).rows).toEqual(
      [{ id: publishedId }],
    );
    await owner.query('GRANT SELECT(id) ON public.automation_runs TO hzense_insight_reader');
    await expect(assertAutomationRole(readerRole, 'reader')).rejects.toThrow(
      'automation_role_invalid',
    );
    await owner.query('REVOKE SELECT(id) ON public.automation_runs FROM hzense_insight_reader');
    await assertAutomationRole(readerRole, 'reader');
  });
  it('discovery fences paid execution, preserves receipts and keeps source results private', async () => {
    const pool = {
      connect: async () => ({ query: (...args) => adminRole.query(...args), release() {} }),
    };
    const operator = 'discovery-test-owner';
    const configId = randomUUID(),
      id = randomUUID();
    await saveAutomationConfig({
      pool,
      owner: operator,
      request: {
        id: configId,
        expectedRevision: 0,
        consent: true,
        config: {
          name: 'Discovery',
          kind: 'source_collection',
          enabled: false,
          frequency: 'daily',
          sourceUrls: [],
          topicIds: ['topic-ai'],
          profileId: randomUUID(),
          profileRevision: 1,
          discovery: { keywords: [], lookbackDays: 2, maxSources: 5 },
        },
      },
    });
    const request = { configId, expectedRevision: 1, requestId: id, consent: true };
    expect((await enqueueAutomation({ pool, owner: operator, request })).created).toBe(true);
    expect((await enqueueAutomation({ pool, owner: operator, request })).created).toBe(false);
    const run = await claimAutomationRun({
      pool,
      owner: operator,
      id,
      limits: { batch: 1000000, daily: 5000000, reserve: 500000 },
    });
    expect(run.reserved_microusd).toBe(500000);
    expect(await claimAutomationRun({ pool, owner: operator, id, limits: {} })).toBeNull();
    const args = { pool, owner: operator, id, token: run.lease_token };
    await beginSourceDiscovery(args);
    await expect(beginSourceDiscovery(args)).rejects.toThrow('stale_attempt');
    await expect(beginSourceDiscovery({ ...args, owner: 'another-owner' })).rejects.toThrow(
      'stale_attempt',
    );
    const result = {
      discovery: { searchRequests: 1 },
      queuedSources: [{ url: 'https://example.com/news', generationId: randomUUID() }],
    };
    await updateAutomationRun({
      ...args,
      phase: 'candidate_tasks_queued',
      result,
      status: 'completed',
      costMicrousd: 27000,
      costSource: 'provider',
    });
    const saved = await readAutomationRun({ pool, owner: operator, id });
    expect(saved.charged_microusd).toBe(27000);
    expect(saved.publication_status).toBe('private');
    expect(await readCollectedSourceUrls({ pool, owner: operator })).toEqual([
      'https://example.com/news',
    ]);
    expect(await readCollectedSourceUrls({ pool, owner: 'another-owner' })).toEqual([]);
    expect(
      (await readerRole.query('SELECT id FROM public.published_topic_insights WHERE id=$1', [id]))
        .rows,
    ).toEqual([]);
  });
});
