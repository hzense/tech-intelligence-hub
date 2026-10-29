import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';
import pg from 'pg';
import { runtimeLeafTopicQuery } from '../lib/runtime-reader-core.ts';
import { validateConnectionTarget } from '../../../packages/database/src/connection-policy.mjs';

const adminUrl = process.env.INSIGHT_TOPIC_TEST_ADMIN_URL;
test(
  'real PostgreSQL tests leafhood against disabled and archived children across the complete tree',
  { skip: !adminUrl },
  async () => {
    validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
    const administrator = new pg.Client({ connectionString: adminUrl });
    let client;
    let created = false;
    const database = `hzense_leaf_${randomUUID().replaceAll('-', '')}`;
    try {
      await administrator.connect();
      const identity = (
        await administrator.query(
          "SELECT current_database() AS database,session_user AS role,current_setting('cluster_name') AS cluster",
        )
      ).rows[0];
      assert.deepEqual(identity, {
        database: 'postgres',
        role: 'postgres',
        cluster: 'hzense-local-test',
      });
      assert.equal(
        (
          await administrator.query(
            "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname<>'postgres'",
          )
        ).rowCount,
        0,
        'A new disposable cluster is required',
      );
      await administrator.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
      created = true;
      const target = new URL(adminUrl);
      target.pathname = `/${database}`;
      client = new pg.Client({ connectionString: target.href });
      await client.connect();
      await client.query(
        'CREATE TABLE public.topics(id text PRIMARY KEY,title text NOT NULL,parent_id text,status text NOT NULL,runtime_enabled boolean NOT NULL)',
      );
      await client.query(`INSERT INTO public.topics VALUES
      ('topic-parent','Parent',NULL,'watching',true),
      ('topic-disabled-child','Disabled child','topic-parent','watching',false),
      ('topic-other-parent','Other parent',NULL,'watching',true),
      ('topic-archived-child','Archived child','topic-other-parent','archived',false),
      ('topic-root-leaf','Root without children',NULL,'watching',true),
      ('topic-disabled-leaf','Disabled leaf',NULL,'watching',false),
      ('topic-archived-leaf','Archived leaf',NULL,'archived',true)`);
      await client.query(
        "INSERT INTO public.topics SELECT 'topic-leaf-'||n,'Leaf '||n,'topic-parent','watching',true FROM generate_series(1,75) n",
      );
      const rows = (await client.query(runtimeLeafTopicQuery, [1001])).rows;
      assert.equal(rows.length, 76);
      const ids = new Set(rows.map((row) => row.id));
      assert.ok(ids.has('topic-root-leaf'), 'A top-level node with no children is a leaf');
      assert.ok(ids.has('topic-leaf-75'), 'The catalog is not truncated to 50 rows');
      for (const id of [
        'topic-parent',
        'topic-other-parent',
        'topic-disabled-child',
        'topic-archived-child',
        'topic-disabled-leaf',
        'topic-archived-leaf',
      ])
        assert.equal(ids.has(id), false, id);
    } finally {
      await client?.end();
      if (created) await administrator.query(`DROP DATABASE "${database}"`);
      await administrator.end();
    }
  },
);
