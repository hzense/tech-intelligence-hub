import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { assertAutomationRole } from '../src/automation-role.mjs';
import {
  AutomationError,
  saveAutomationConfig,
  enqueueAutomation,
  claimAutomationRun,
  beginSourceDiscovery,
  updateAutomationRun,
  readCollectedSourceUrls,
  readAutomationRun,
  readAutomationDashboard,
  readAutomationRunDetail,
  deleteAutomationConfig,
  enqueueDueAutomations,
  publishAutomationInsight,
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
  const pool = {
    connect: async () => ({ query: (...args) => adminRole.query(...args), release() {} }),
  };
  const makeConfig = (overrides = {}) => ({
    name: 'Deletion fixture',
    kind: 'source_collection',
    enabled: false,
    frequency: 'manual',
    sourceUrls: [],
    topicIds: [],
    profileId: randomUUID(),
    profileRevision: 1,
    discovery: { keywords: [], lookbackDays: 2, maxSources: 5 },
    ...overrides,
  });
  async function save(ownerId, overrides = {}) {
    return saveAutomationConfig({
      pool,
      owner: ownerId,
      request: {
        id: randomUUID(),
        expectedRevision: 0,
        consent: true,
        config: makeConfig(overrides),
      },
    });
  }
  const deletion = (config, ownerId, overrides = {}) =>
    deleteAutomationConfig({
      pool,
      owner: ownerId,
      request: { id: config.id, expectedRevision: config.revision, consent: true, ...overrides },
    });
  // The budget ledger is global. Each case owns and removes only its synthetic
  // configuration/run fixtures; unrelated cases are never reset or backdated.
  async function withBudgetFixture(work) {
    const configIds = [];
    const newConfig = async () => {
      const operator = `budget-${randomUUID()}`;
      const config = await save(operator);
      configIds.push(config.id);
      return { operator, config };
    };
    const queue = async () => {
      const { operator, config } = await newConfig();
      const id = randomUUID();
      await enqueueAutomation({
        pool,
        owner: operator,
        request: { configId: config.id, expectedRevision: 1, requestId: id, consent: true },
      });
      return { owner: operator, id };
    };
    const record = async (changes = {}) => {
      const { operator, config } = await newConfig();
      const id = randomUUID();
      const row = {
        status: 'unknown',
        phase: 'source_failed',
        snapshot: config.config,
        result: {
          discovery: { articles: [] },
          discoveryCostSource: 'provider',
          discoveryCostMicrousd: 7903,
        },
        reserved: 5000000,
        charged: 7903,
        costSource: 'provider',
        dayOffset: 0,
        leaseToken: null,
        leaseUntil: null,
        finished: true,
        ...changes,
      };
      await owner.query(
        `INSERT INTO public.automation_runs(
          id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase,
          result,reserved_microusd,charged_microusd,cost_source,budget_day,
          lease_token,lease_until,finished_at
        ) VALUES(
          $1,$2,$3,1,$4::jsonb,$5,'manual',$6,$7,$8::jsonb,$9,$10,$11,
          (clock_timestamp() AT TIME ZONE 'UTC')::date+$12::integer,$13,$14,
          CASE WHEN $15 THEN clock_timestamp() ELSE NULL END
        )`,
        [
          id,
          config.id,
          operator,
          JSON.stringify(row.snapshot),
          `manual:${id}`,
          row.status,
          row.phase,
          row.result === null ? null : JSON.stringify(row.result),
          row.reserved,
          row.charged,
          row.costSource,
          row.dayOffset,
          row.leaseToken,
          row.leaseUntil,
          row.finished,
        ],
      );
      return id;
    };
    try {
      return await work({ queue, record });
    } finally {
      if (configIds.length) {
        await owner.query('DELETE FROM public.automation_runs WHERE config_id=ANY($1::uuid[])', [
          configIds,
        ]);
        await owner.query('DELETE FROM public.automation_configs WHERE id=ANY($1::uuid[])', [
          configIds,
        ]);
      }
    }
  }

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
    await owner.query(
      'CREATE TABLE public.hzense_schema_migrations(name text PRIMARY KEY,checksum text)',
    );
    await owner.query(await sql('migrations/0026_automation_tasks.sql'));
    await owner.query(
      "INSERT INTO public.hzense_schema_migrations(name) VALUES('0026_automation_tasks.sql')",
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
  it('settles old source-failure provider receipts across owners without rewriting the failed tasks', async () => {
    await withBudgetFixture(async ({ queue, record }) => {
      const ids = [];
      for (const charged of [7903, 7349]) {
        ids.push(
          await record({
            charged,
            result: {
              discovery: { articles: [] },
              discoveryCostSource: 'provider',
              discoveryCostMicrousd: charged,
            },
          }),
        );
      }
      const before = (
        await owner.query(
          'SELECT * FROM public.automation_runs WHERE id=ANY($1::uuid[]) ORDER BY id',
          [ids],
        )
      ).rows;
      const next = await queue();
      const run = await claimAutomationRun({
        pool,
        ...next,
        limits: { batch: 5000000, daily: 10000000, reserve: 5000000 },
      });
      expect(run).toMatchObject({ status: 'running', reserved_microusd: 5000000 });
      // Exact receipt boundary proves the two old reservations became 15,252,
      // not zero. The new running claim still consumes its complete reservation.
      const blocked = await queue();
      expect(
        await claimAutomationRun({
          pool,
          ...blocked,
          limits: { batch: 4984749, daily: 10000000, reserve: 4984749 },
        }),
      ).toBeNull();
      expect(await readAutomationRun({ pool, ...blocked })).toMatchObject({
        status: 'failed',
        phase: 'budget_exceeded',
        reserved_microusd: 0,
      });
      expect(
        (
          await owner.query(
            'SELECT * FROM public.automation_runs WHERE id=ANY($1::uuid[]) ORDER BY id',
            [ids],
          )
        ).rows,
      ).toEqual(before);
    });
  });
  it.each([
    ['missing receipt', { result: {} }],
    ['null result', { result: null }],
    ['estimated charge', { costSource: 'estimate' }],
    ['reserve charge', { costSource: 'reserve' }],
    ['missing charge source', { costSource: null }],
    [
      'discovery estimate',
      { result: { discoveryCostSource: 'estimate', discoveryCostMicrousd: 7903 } },
    ],
    ['missing receipt source', { result: { discoveryCostMicrousd: 7903 } }],
    [
      'receipt amount mismatch',
      { result: { discoveryCostSource: 'provider', discoveryCostMicrousd: 7349 } },
    ],
    [
      'string receipt',
      { result: { discoveryCostSource: 'provider', discoveryCostMicrousd: '7903' } },
    ],
    ['null receipt', { result: { discoveryCostSource: 'provider', discoveryCostMicrousd: null } }],
    [
      'object receipt',
      { result: { discoveryCostSource: 'provider', discoveryCostMicrousd: { value: 7903 } } },
    ],
    [
      'array receipt',
      { result: { discoveryCostSource: 'provider', discoveryCostMicrousd: [7903] } },
    ],
    [
      'boolean receipt',
      { result: { discoveryCostSource: 'provider', discoveryCostMicrousd: true } },
    ],
    [
      'negative receipt',
      { result: { discoveryCostSource: 'provider', discoveryCostMicrousd: -7903 } },
    ],
    [
      'fractional receipt',
      { result: { discoveryCostSource: 'provider', discoveryCostMicrousd: 7903.5 } },
    ],
    [
      'invalid numeric text',
      { result: { discoveryCostSource: 'provider', discoveryCostMicrousd: 'not-a-number' } },
    ],
    ['missing discovery configuration', { snapshot: { kind: 'source_collection' } }],
    ['null discovery configuration', { snapshot: { kind: 'source_collection', discovery: null } }],
    ['array discovery configuration', { snapshot: { kind: 'source_collection', discovery: [] } }],
    ['discovery failure phase', { phase: 'discovery_failed' }],
    ['still running', { status: 'running' }],
    ['topic insight', { snapshot: { kind: 'topic_insight', discovery: {} } }],
    ['remaining lease token', { leaseToken: randomUUID() }],
    ['remaining lease expiry', { leaseUntil: new Date(0) }],
    ['no terminal timestamp', { finished: false }],
  ])('retains the reservation for %s without unsafe JSON casts', async (_name, changes) => {
    await withBudgetFixture(async ({ queue, record }) => {
      const id = await record(changes);
      const before = (await owner.query('SELECT * FROM public.automation_runs WHERE id=$1', [id]))
        .rows[0];
      const next = await queue();
      expect(
        await claimAutomationRun({
          pool,
          ...next,
          limits: { batch: 5000000, daily: 5015252, reserve: 5000000 },
        }),
      ).toBeNull();
      expect(await readAutomationRun({ pool, ...next })).toMatchObject({
        status: 'failed',
        phase: 'budget_exceeded',
        charged_microusd: 0,
        reserved_microusd: 0,
      });
      expect(
        (await owner.query('SELECT * FROM public.automation_runs WHERE id=$1', [id])).rows[0],
      ).toEqual(before);
    });
  });
  it('accepts a genuine zero-cost provider receipt without retaining its reservation', async () => {
    await withBudgetFixture(async ({ queue, record }) => {
      await record({
        charged: 0,
        result: { discoveryCostSource: 'provider', discoveryCostMicrousd: 0 },
      });
      expect(
        await claimAutomationRun({
          pool,
          ...(await queue()),
          limits: { batch: 5000000, daily: 5000000, reserve: 5000000 },
        }),
      ).toMatchObject({ status: 'running', reserved_microusd: 5000000 });
    });
  });
  it.each(['unknown', 'running', 'completed'])(
    'accounts for a %s charge above its original reservation',
    async (status) => {
      await withBudgetFixture(async ({ queue, record }) => {
        await record({
          status,
          charged: 6000000,
          result: { discoveryCostSource: 'provider', discoveryCostMicrousd: 6000000 },
        });
        const next = await queue();
        expect(
          await claimAutomationRun({
            pool,
            ...next,
            limits: { batch: 5000000, daily: 10000000, reserve: 5000000 },
          }),
        ).toBeNull();
        expect(await readAutomationRun({ pool, ...next })).toMatchObject({
          phase: 'budget_exceeded',
        });
      });
    },
  );
  it('uses the UTC budget day regardless of the database session timezone', async () => {
    await withBudgetFixture(async ({ queue, record }) => {
      await record({ charged: 10000000, dayOffset: -1 });
      await record({ charged: 10000000, dayOffset: 1 });
      await record();
      const timezone = (
        await adminRole.query(
          `SELECT CASE WHEN (clock_timestamp() AT TIME ZONE 'UTC')::time < time '12:00'
            THEN 'Etc/GMT+12' ELSE 'Pacific/Kiritimati' END AS timezone`,
        )
      ).rows[0].timezone;
      const previousTimezone = (await adminRole.query('SHOW TimeZone')).rows[0].TimeZone;
      await adminRole.query("SELECT set_config('TimeZone',$1,false)", [timezone]);
      try {
        expect(
          (
            await adminRole.query(
              "SELECT CURRENT_DATE<>(clock_timestamp() AT TIME ZONE 'UTC')::date AS different",
            )
          ).rows[0].different,
        ).toBe(true);
        const next = await queue();
        expect(
          await claimAutomationRun({
            pool,
            ...next,
            limits: { batch: 5000000, daily: 5007903, reserve: 5000000 },
          }),
        ).toMatchObject({ status: 'running', reserved_microusd: 5000000 });
        expect(
          (
            await owner.query(
              "SELECT budget_day=(clock_timestamp() AT TIME ZONE 'UTC')::date AS utc_day FROM public.automation_runs WHERE id=$1",
              [next.id],
            )
          ).rows[0].utc_day,
        ).toBe(true);
      } finally {
        await adminRole.query("SELECT set_config('TimeZone',$1,false)", [previousTimezone]);
      }
    });
  });
  it('serializes global claims after receipt settlement instead of overspending freed reservations', async () => {
    await withBudgetFixture(async ({ queue, record }) => {
      await record();
      const tasks = [await queue(), await queue()];
      // Reuse the existing restricted-role connection plus exactly one new
      // connection to stay within that role's CONNECTION LIMIT 2.
      const concurrentPool = new pg.Pool({ connectionString: url(roleNames[0]), max: 1 });
      try {
        const runs = await Promise.all(
          tasks.map((task, index) =>
            claimAutomationRun({
              pool: index === 0 ? pool : concurrentPool,
              ...task,
              limits: { batch: 5000000, daily: 10000000, reserve: 5000000 },
            }),
          ),
        );
        expect(runs.filter(Boolean)).toHaveLength(1);
        expect(runs.filter((run) => run === null)).toHaveLength(1);
        const saved = [];
        for (const task of tasks) saved.push(await readAutomationRun({ pool, ...task }));
        expect(saved.map((run) => run.status).sort()).toEqual(['failed', 'running']);
        expect(saved.find((run) => run.status === 'failed').phase).toBe('budget_exceeded');
      } finally {
        await concurrentPool.end();
      }
    });
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
  it('keeps 0026 storage usable but refuses deletion before its separate migration', async () => {
    const config = await save('pre-migration-owner');
    const dashboard = await readAutomationDashboard({ pool, owner: 'pre-migration-owner' });
    expect(dashboard.configDeletionAvailable).toBe(false);
    expect(dashboard.configs.map((row) => row.id)).toContain(config.id);
    await expect(deletion(config, 'pre-migration-owner')).rejects.toThrow(
      'config_deletion_unavailable',
    );
    expect(
      (await readAutomationDashboard({ pool, owner: 'pre-migration-owner' })).configs,
    ).toHaveLength(1);
  });
  it('requires the new exact ACL after 0027 instead of silently using old permissions', async () => {
    const migration = await sql('migrations/0027_automation_config_deletion.sql');
    await owner.query(migration);
    await owner.query(
      "INSERT INTO public.hzense_schema_migrations(name,checksum) VALUES('0027_automation_config_deletion.sql',$1)",
      [createHash('sha256').update(migration).digest('hex')],
    );
    await expect(assertAutomationRole(adminRole, 'admin')).rejects.toThrow(
      'automation_role_invalid',
    );
    await expect(readAutomationDashboard({ pool, owner: 'pre-migration-owner' })).rejects.toThrow(
      'database_unavailable',
    );
    await owner.query(await sql('roles/upgrade_automation_config_deletion.sql'));
    await assertAutomationRole(adminRole, 'admin');
    await assertAutomationRole(readerRole, 'reader');
    expect(
      (await readAutomationDashboard({ pool, owner: 'pre-migration-owner' }))
        .configDeletionAvailable,
    ).toBe(true);
    await expect(adminRole.query('DELETE FROM public.automation_configs')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      adminRole.query(
        "INSERT INTO public.automation_configs(id,owner_id,revision,config,enabled,deleted_at) VALUES($1,'forbidden',1,'{}',false,NULL)",
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('repeats the exact 0027 grant idempotently without changing configurations or widening authority', async () => {
    const before = await owner.query(
      'SELECT id,revision,enabled,deleted_at FROM public.automation_configs ORDER BY id',
    );
    const upgrade = await sql('roles/upgrade_automation_config_deletion.sql');
    await owner.query(upgrade);
    await owner.query(upgrade);
    await assertAutomationRole(adminRole, 'admin');
    await assertAutomationRole(readerRole, 'reader');
    expect(
      (
        await owner.query(
          'SELECT id,revision,enabled,deleted_at FROM public.automation_configs ORDER BY id',
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await owner.query(
          "SELECT has_column_privilege('hzense_automation_admin','public.automation_configs','deleted_at','SELECT') AS read, has_column_privilege('hzense_automation_admin','public.automation_configs','deleted_at','UPDATE') AS update, has_column_privilege('hzense_automation_admin','public.automation_configs','deleted_at','INSERT') AS insert, has_table_privilege('hzense_automation_admin','public.automation_configs','DELETE') AS delete",
        )
      ).rows[0],
    ).toEqual({ read: true, update: true, insert: false, delete: false });
  });
  it('rejects a partial deletion grant rather than silently repairing an unreviewed ACL', async () => {
    await owner.query(
      'REVOKE UPDATE(deleted_at) ON public.automation_configs FROM hzense_automation_admin',
    );
    try {
      await expect(
        owner.query(await sql('roles/upgrade_automation_config_deletion.sql')),
      ).rejects.toThrow('Automation admin effective column ACL mismatch');
      await owner.query('ROLLBACK');
      expect(
        (
          await owner.query(
            "SELECT has_column_privilege('hzense_automation_admin','public.automation_configs','deleted_at','UPDATE') AS update",
          )
        ).rows[0].update,
      ).toBe(false);
    } finally {
      await owner.query('ROLLBACK');
      await owner.query(
        'GRANT UPDATE(deleted_at) ON public.automation_configs TO hzense_automation_admin',
      );
    }
    await assertAutomationRole(adminRole, 'admin');
  });
  it('soft deletes once, stops scheduling, hides the configuration, and cannot be revived by stale edits', async () => {
    const operator = 'delete-owner';
    const config = await save(operator, { enabled: true, frequency: 'daily' });
    const result = await deletion(config, operator);
    expect(result).toMatchObject({ id: config.id, revision: 2 });
    expect(result.deleted_at).toBeInstanceOf(Date);
    expect(await deletion(config, operator)).toEqual(result);
    const stored = (
      await owner.query('SELECT * FROM public.automation_configs WHERE id=$1', [config.id])
    ).rows[0];
    expect(stored).toMatchObject({
      revision: 2,
      enabled: false,
      next_run_at: null,
      config: { enabled: false },
    });
    expect((await readAutomationDashboard({ pool, owner: operator })).configs).toEqual([]);
    await expect(
      saveAutomationConfig({
        pool,
        owner: operator,
        request: { id: config.id, expectedRevision: 2, consent: true, config: makeConfig() },
      }),
    ).rejects.toThrow('not_found');
    await expect(
      enqueueAutomation({
        pool,
        owner: operator,
        request: {
          configId: config.id,
          expectedRevision: 2,
          requestId: randomUUID(),
          consent: true,
        },
      }),
    ).rejects.toThrow('not_found');
    expect(await enqueueDueAutomations({ pool })).toEqual([]);
    await expect(
      owner.query('UPDATE public.automation_configs SET enabled=true WHERE id=$1', [config.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owner.query(
        'UPDATE public.automation_configs SET next_run_at=clock_timestamp() WHERE id=$1',
        [config.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('requires explicit consent, exact fields, owner scope and the current revision', async () => {
    const config = await save('validation-owner');
    await expect(deletion(config, 'another-owner')).rejects.toThrow('not_found');
    for (const change of [
      { consent: false },
      { expectedRevision: 0 },
      { expectedRevision: 1.5 },
      { additional: true },
    ]) {
      await expect(deletion(config, 'validation-owner', change)).rejects.toThrow('invalid_request');
    }
    await expect(deletion(config, 'validation-owner', { expectedRevision: 2 })).rejects.toThrow(
      'revision_conflict',
    );
    await deletion(config, 'validation-owner');
    await expect(deletion(config, 'validation-owner', { expectedRevision: 2 })).rejects.toThrow(
      'revision_conflict',
    );
    await expect(deletion(config, 'another-owner')).rejects.toThrow('not_found');
  });
  it.each([
    ['queued', null, null],
    ['running', randomUUID(), new Date(Date.now() + 60_000)],
    ['running', randomUUID(), new Date(0)],
    ['unknown', null, null],
    ['completed', randomUUID(), new Date(0)],
    ['failed', null, new Date(Date.now() + 60_000)],
    ['cancelled', randomUUID(), null],
  ])(
    'refuses deletion while a %s task or unreleased lease requires reconciliation',
    async (status, leaseToken, leaseUntil) => {
      const operator = `blocked-${randomUUID()}`;
      const config = await save(operator);
      const id = randomUUID();
      await owner.query(
        "INSERT INTO public.automation_runs(id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase,lease_token,lease_until,created_at) VALUES($1,$2,$3,1,$4::jsonb,$5,'manual',$6,'fixture',$7,$8,clock_timestamp()-interval '3 hours')",
        [
          id,
          config.id,
          operator,
          JSON.stringify(config.config),
          `manual:${id}`,
          status,
          leaseToken,
          leaseUntil,
        ],
      );
      await expect(deletion(config, operator)).rejects.toThrow('config_in_use');
      expect((await readAutomationDashboard({ pool, owner: operator })).configs).toHaveLength(1);
      await owner.query(
        "UPDATE public.automation_runs SET status='failed',lease_token=NULL,lease_until=NULL WHERE id=$1",
        [id],
      );
      await deletion(config, operator);
    },
  );
  it('preserves task results, frozen inputs, fees, owner access and publication after deletion', async () => {
    const operator = 'historical-owner';
    const config = await save(operator);
    const id = randomUUID();
    const snapshot = { ...config.config, kind: 'topic_insight' };
    const result = {
      kind: 'topic_insight',
      title: 'Retained report',
      inputs: [{ id: 'signal-1' }],
    };
    await owner.query(
      "INSERT INTO public.automation_runs(id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase,result,frozen_inputs,reserved_microusd,charged_microusd,cost_source) VALUES($1,$2,$3,1,$4::jsonb,$5,'manual','completed','completed',$6::jsonb,$7::jsonb,500000,27000,'provider')",
      [
        id,
        config.id,
        operator,
        JSON.stringify(snapshot),
        `manual:${id}`,
        JSON.stringify(result),
        JSON.stringify({ inputs: result.inputs }),
      ],
    );
    const before = (await owner.query('SELECT * FROM public.automation_runs WHERE id=$1', [id]))
      .rows[0];
    await deletion(config, operator);
    expect(
      (await owner.query('SELECT * FROM public.automation_runs WHERE id=$1', [id])).rows[0],
    ).toEqual(before);
    expect((await readAutomationDashboard({ pool, owner: operator })).runs).toHaveLength(1);
    const summary = (await readAutomationDashboard({ pool, owner: operator })).runs[0];
    expect(summary.snapshot).toEqual({ name: snapshot.name, kind: 'topic_insight' });
    expect(summary.result).not.toHaveProperty('inputs');
    expect(summary.result).not.toHaveProperty('title');
    expect(summary).not.toHaveProperty('frozen_inputs');
    expect(summary).not.toHaveProperty('lease_token');
    expect(await readAutomationRunDetail({ pool, owner: operator, id })).toMatchObject({
      result,
      charged_microusd: 27000,
    });
    await expect(readAutomationRunDetail({ pool, owner: 'another-owner', id })).rejects.toThrow(
      'not_found',
    );
    expect(await readAutomationRun({ pool, owner: operator, id })).toMatchObject({
      result,
      reserved_microusd: 500000,
      charged_microusd: 27000,
    });
    await expect(readAutomationRun({ pool, owner: 'another-owner', id })).rejects.toThrow(
      'not_found',
    );
    await publishAutomationInsight({ pool, owner: operator, id, confirm: true });
    expect(
      (await readerRole.query('SELECT id FROM public.published_topic_insights WHERE id=$1', [id]))
        .rows,
    ).toEqual([{ id }]);
  });
  it('checks all tasks even when the blocking task is older than the dashboard history limit', async () => {
    const operator = 'old-blocking-task-owner';
    const config = await save(operator);
    const oldId = randomUUID();
    await owner.query(
      "INSERT INTO public.automation_runs(id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase,created_at) VALUES($1,$2,$3,1,$4::jsonb,$5,'manual','unknown','outcome_unknown',clock_timestamp()-interval '1 day')",
      [oldId, config.id, operator, JSON.stringify(config.config), `manual:${oldId}`],
    );
    await owner.query(
      "INSERT INTO public.automation_runs(id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase) SELECT gen_random_uuid(),$1,$2,1,$3::jsonb,'manual:history:'||n,'manual','completed','completed' FROM generate_series(1,101) n",
      [config.id, operator, JSON.stringify(config.config)],
    );
    const dashboard = await readAutomationDashboard({ pool, owner: operator });
    expect(dashboard.runs).toHaveLength(100);
    expect(dashboard.runs.some((run) => run.id === oldId)).toBe(false);
    await expect(deletion(config, operator)).rejects.toThrow('config_in_use');
  });
  it('keeps generation linkage and rejection counts while excluding large results from polling', async () => {
    const operator = 'summary-projection-owner';
    const config = await save(operator);
    const id = randomUUID();
    const generationIds = Array.from({ length: 10 }, () => randomUUID());
    const result = {
      generationIds: [
        'invalid',
        generationIds[0],
        generationIds[0],
        null,
        ...generationIds.slice(1),
      ],
      failed: 2,
      discovery: { articles: [], rejected: 8, duplicates: 0 },
      report: { body: 'synthetic private result'.repeat(10000) },
      inputs: [{ body: 'synthetic source' }],
    };
    await owner.query(
      "INSERT INTO public.automation_runs(id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase,result,frozen_inputs) VALUES($1,$2,$3,1,$4::jsonb,$5,'manual','completed','no_new_sources',$6::jsonb,$7::jsonb)",
      [
        id,
        config.id,
        operator,
        JSON.stringify(config.config),
        `manual:${id}`,
        JSON.stringify(result),
        JSON.stringify({ inputs: result.inputs }),
      ],
    );
    const summary = (await readAutomationDashboard({ pool, owner: operator })).runs[0];
    expect(summary.result).toEqual({
      generationIds: generationIds.slice(0, 8),
      failed: 2,
      discovery: { articleCount: 0, rejected: 8, duplicates: 0 },
    });
    expect(summary.snapshot).toEqual({ name: config.config.name, kind: 'source_collection' });
    expect(JSON.stringify(summary).length).toBeLessThan(2000);
    const detail = await readAutomationRunDetail({ pool, owner: operator, id });
    expect(detail.result).toEqual(result);
    expect(detail).not.toHaveProperty('frozen_inputs');
    expect((await readAutomationRun({ pool, owner: operator, id })).frozen_inputs).toEqual({
      inputs: result.inputs,
    });
    for (const discovery of [
      { rejected: 8, duplicates: 0 },
      { articles: {}, rejected: 8, duplicates: 0 },
    ]) {
      await owner.query('UPDATE public.automation_runs SET result=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify({ discovery }),
      ]);
      const malformed = (await readAutomationDashboard({ pool, owner: operator })).runs[0];
      expect(malformed.result.discovery.articleCount).toBe(null);
      expect(malformed.result.generationIds).toEqual([]);
    }
  });
  it('does not count deleted configurations against the 50 visible-configuration quota', async () => {
    const operator = 'quota-owner';
    const config = await save(operator);
    for (let index = 1; index < 50; index += 1) {
      await adminRole.query(
        'INSERT INTO public.automation_configs(id,owner_id,revision,config,enabled) VALUES($1,$2,1,$3::jsonb,false)',
        [randomUUID(), operator, JSON.stringify(makeConfig())],
      );
    }
    await expect(save(operator)).rejects.toThrow('config_limit');
    await deletion(config, operator);
    await save(operator);
    expect((await readAutomationDashboard({ pool, owner: operator })).configs).toHaveLength(50);
    expect(
      (
        await owner.query(
          'SELECT count(*)::integer AS count FROM public.automation_configs WHERE owner_id=$1',
          [operator],
        )
      ).rows[0].count,
    ).toBe(51);
  });
  it('serializes deletion against manual enqueue so only one operation succeeds', async () => {
    const operator = 'concurrent-owner';
    const config = await save(operator);
    // A distinct local-owner pool exercises real transaction/advisory-lock concurrency without
    // exceeding the intentionally small restricted-role connection allowance.
    const concurrentPool = new pg.Pool({ connectionString: url(), max: 2 });
    try {
      const outcomes = await Promise.allSettled([
        deleteAutomationConfig({
          pool: concurrentPool,
          owner: operator,
          request: { id: config.id, expectedRevision: 1, consent: true },
        }),
        enqueueAutomation({
          pool: concurrentPool,
          owner: operator,
          request: {
            configId: config.id,
            expectedRevision: 1,
            requestId: randomUUID(),
            consent: true,
          },
        }),
      ]);
      expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((entry) => entry.status === 'rejected');
      expect(['not_found', 'config_in_use']).toContain(rejected.reason.code);
      const stored = (
        await owner.query('SELECT deleted_at FROM public.automation_configs WHERE id=$1', [
          config.id,
        ])
      ).rows[0];
      const runs = (
        await owner.query('SELECT id FROM public.automation_runs WHERE config_id=$1', [config.id])
      ).rows;
      expect(stored.deleted_at ? runs.length === 0 : runs.length === 1).toBe(true);
    } finally {
      await concurrentPool.end();
    }
  });
  it('defensively refuses to claim a queued task attached to a deleted configuration', async () => {
    const operator = 'claim-deleted-owner';
    const config = await save(operator);
    await deletion(config, operator);
    const id = randomUUID();
    // Owner-only synthetic corruption: ordinary enqueue is rejected by the store.
    await owner.query(
      "INSERT INTO public.automation_runs(id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase) VALUES($1,$2,$3,1,$4::jsonb,$5,'manual','queued','queued')",
      [id, config.id, operator, JSON.stringify(config.config), `manual:${id}`],
    );
    expect(
      await claimAutomationRun({
        pool,
        owner: operator,
        id,
        limits: { batch: 1000000, daily: 5000000, reserve: 500000 },
      }),
    ).toBeNull();
    expect(await readAutomationRun({ pool, owner: operator, id })).toMatchObject({
      status: 'cancelled',
      phase: 'configuration_changed',
      reserved_microusd: 0,
      lease_token: null,
    });
  });
  it('filters ready scheduler kinds before LIMIT and does not advance an excluded source schedule', async () => {
    const operator = 'scheduler-readiness-owner';
    const sourceConfig = await save(operator, { enabled: true, frequency: 'daily' });
    const insightConfig = await save(operator, {
      kind: 'topic_insight',
      enabled: true,
      frequency: 'daily',
      topicIds: ['topic-ai'],
      discovery: undefined,
    });
    // The unavailable source is due earlier; LIMIT 1 must still admit the ready
    // insight rather than selecting/skipping the source and starving the queue.
    await owner.query(
      "UPDATE public.automation_configs SET next_run_at=clock_timestamp()-CASE WHEN id=$1 THEN interval '2 days' ELSE interval '1 day' END WHERE id=ANY($2::uuid[])",
      [sourceConfig.id, [sourceConfig.id, insightConfig.id]],
    );
    const before = (
      await owner.query('SELECT * FROM public.automation_configs WHERE id=$1', [sourceConfig.id])
    ).rows[0];
    const runs = await enqueueDueAutomations({ pool, limit: 1, kinds: ['topic_insight'] });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      created: true,
      run: { config_id: insightConfig.id, trigger: 'scheduled', status: 'queued' },
    });
    expect(
      (await owner.query('SELECT * FROM public.automation_configs WHERE id=$1', [sourceConfig.id]))
        .rows[0],
    ).toEqual(before);
    expect(
      (
        await owner.query('SELECT id FROM public.automation_runs WHERE config_id=$1', [
          sourceConfig.id,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (
        await owner.query(
          'SELECT next_run_at>clock_timestamp() AS advanced FROM public.automation_configs WHERE id=$1',
          [insightConfig.id],
        )
      ).rows[0].advanced,
    ).toBe(true);
    expect(await enqueueDueAutomations({ pool, kinds: [] })).toEqual([]);
    expect(
      (await owner.query('SELECT * FROM public.automation_configs WHERE id=$1', [sourceConfig.id]))
        .rows[0],
    ).toEqual(before);
  });
  it('rolls back failed manual admission before inserting a task or mutating its schedule', async () => {
    const operator = 'manual-admission-failure-owner';
    const config = await save(operator);
    const id = randomUUID();
    const before = (
      await owner.query('SELECT * FROM public.automation_configs WHERE id=$1', [config.id])
    ).rows[0];
    let checks = 0;
    await expect(
      enqueueAutomation({
        pool,
        owner: operator,
        request: {
          configId: config.id,
          expectedRevision: config.revision,
          requestId: id,
          consent: true,
        },
        beforeEnqueue: async (current) => {
          checks++;
          expect(current).toEqual(config.config);
          throw new AutomationError('not_configured');
        },
      }),
    ).rejects.toThrow('not_configured');
    expect(checks).toBe(1);
    expect(
      (
        await owner.query('SELECT id FROM public.automation_runs WHERE id=$1 OR config_id=$2', [
          id,
          config.id,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (await owner.query('SELECT * FROM public.automation_configs WHERE id=$1', [config.id]))
        .rows[0],
    ).toEqual(before);
    await assertAutomationRole(adminRole, 'admin');
  });
  it('replays a saved request after a profile revision change without rerunning admission', async () => {
    const operator = 'manual-admission-replay-owner';
    const config = await save(operator);
    const request = {
      configId: config.id,
      expectedRevision: config.revision,
      requestId: randomUUID(),
      consent: true,
    };
    let checks = 0;
    const first = await enqueueAutomation({
      pool,
      owner: operator,
      request,
      beforeEnqueue: async () => {
        checks++;
      },
    });
    expect(first.created).toBe(true);
    expect(checks).toBe(1);
    const before = (
      await owner.query('SELECT * FROM public.automation_runs WHERE id=$1', [request.requestId])
    ).rows[0];
    await saveAutomationConfig({
      pool,
      owner: operator,
      request: {
        id: config.id,
        expectedRevision: config.revision,
        consent: true,
        config: { ...config.config, profileRevision: config.config.profileRevision + 1 },
      },
    });
    const replay = await enqueueAutomation({
      pool,
      owner: operator,
      request,
      beforeEnqueue: async () => {
        checks++;
        throw new AutomationError('profile_not_ready');
      },
    });
    expect(replay.created).toBe(false);
    expect(replay.run.id).toBe(request.requestId);
    expect(checks).toBe(1);
    expect(
      (await owner.query('SELECT * FROM public.automation_runs WHERE config_id=$1', [config.id]))
        .rows,
    ).toEqual([before]);
    await assertAutomationRole(adminRole, 'admin');
  });
});
