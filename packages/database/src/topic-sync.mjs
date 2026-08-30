import { createHash } from 'node:crypto';
import pg from 'pg';
import { migrationLockKeys } from './migrate.mjs';

const { Client } = pg;
const topicIdPattern = /^topic-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const topicStatuses = new Set(['watching', 'active', 'strategic', 'archived']);

function requireTopicId(value, label) {
  if (typeof value !== 'string' || !topicIdPattern.test(value)) {
    throw new Error(`${label} must be a canonical Topic ID`);
  }
  return value;
}

function normalizeTopic(row, label) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${label} must be an object`);
  }
  const id = requireTopicId(row.id, `${label}.id`);
  if (typeof row.title !== 'string' || row.title.trim().length === 0) {
    throw new Error(`${label}.title must be a non-empty string`);
  }
  if (row.title !== row.title.trim()) {
    throw new Error(`${label}.title must not contain leading or trailing whitespace`);
  }
  const parentId = row.parentId === null ? null : requireTopicId(row.parentId, `${label}.parentId`);
  if (!topicStatuses.has(row.status)) {
    throw new Error(`${label}.status is not a supported Topic status`);
  }
  if (typeof row.runtimeEnabled !== 'boolean') {
    throw new Error(`${label}.runtimeEnabled must be a boolean`);
  }
  return { id, title: row.title, parentId, status: row.status, runtimeEnabled: row.runtimeEnabled };
}

function normalizeTopicRows(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array`);
  const normalized = [];
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    const topic = normalizeTopic(row, `${label}[${index}]`);
    if (ids.has(topic.id)) throw new Error(`${label} contains duplicate Topic ID ${topic.id}`);
    ids.add(topic.id);
    normalized.push(topic);
  }
  return normalized.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function normalizeDesiredTopics(rows) {
  const topics = normalizeTopicRows(rows, 'desiredTopics');
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));

  for (const topic of topics) {
    if (topic.parentId !== null && !topicById.has(topic.parentId)) {
      throw new Error(`Desired Topic ${topic.id} has missing parent ${topic.parentId}`);
    }
    if (topic.status === 'archived' && topic.runtimeEnabled) {
      throw new Error(`Archived desired Topic ${topic.id} cannot be runtime enabled`);
    }
    if ((topic.status === 'active' || topic.status === 'strategic') && !topic.runtimeEnabled) {
      throw new Error(
        `Desired Topic ${topic.id} with status ${topic.status} must be runtime enabled`,
      );
    }
  }

  for (const topic of topics) {
    const visited = new Set([topic.id]);
    let cursor = topic;
    while (cursor.parentId !== null) {
      if (visited.has(cursor.parentId)) {
        throw new Error(`Desired Topic hierarchy contains a cycle at ${cursor.parentId}`);
      }
      visited.add(cursor.parentId);
      cursor = topicById.get(cursor.parentId);
    }
  }

  return topics;
}

export function topicProjectionFingerprint(rows) {
  const topics = normalizeDesiredTopics(rows);
  return topicRowsFingerprint(topics, 'desiredTopics');
}

function topicRowsFingerprint(rows, label) {
  const topics = normalizeTopicRows(rows, label);
  const canonicalRows = topics.map((topic) => [
    topic.id,
    topic.title,
    topic.parentId,
    topic.status,
    topic.runtimeEnabled,
  ]);
  return createHash('sha256').update(JSON.stringify(canonicalRows)).digest('hex');
}

function topicFieldsMatch(left, right) {
  return (
    left.title === right.title &&
    left.parentId === right.parentId &&
    left.status === right.status &&
    left.runtimeEnabled === right.runtimeEnabled
  );
}

export function planTopicSync(desiredRows, existingRows) {
  const desired = normalizeDesiredTopics(desiredRows);
  const existing = normalizeTopicRows(existingRows, 'existingTopics');
  const desiredById = new Map(desired.map((topic) => [topic.id, topic]));
  const existingById = new Map(existing.map((topic) => [topic.id, topic]));
  const unexpectedIds = existing
    .filter((topic) => !desiredById.has(topic.id))
    .map((topic) => topic.id);

  if (unexpectedIds.length > 0) {
    throw new Error(
      `Database contains Topic IDs outside authoritative Taxonomy: ${unexpectedIds.join(', ')}`,
    );
  }

  const inserts = desired.filter((topic) => !existingById.has(topic.id));
  const updates = desired.filter((topic) => {
    const current = existingById.get(topic.id);
    return current !== undefined && !topicFieldsMatch(topic, current);
  });
  const unchanged = desired.filter((topic) => {
    const current = existingById.get(topic.id);
    return current !== undefined && topicFieldsMatch(topic, current);
  });
  const fingerprint = topicProjectionFingerprint(desired);
  const databaseStateFingerprint = topicRowsFingerprint(existing, 'existingTopics');
  const planFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        projection: fingerprint,
        databaseState: databaseStateFingerprint,
        inserts: inserts.map((topic) => topic.id),
        updates: updates.map((topic) => topic.id),
        unchanged: unchanged.map((topic) => topic.id),
      }),
    )
    .digest('hex');

  return {
    fingerprint,
    databaseStateFingerprint,
    planFingerprint,
    desiredCount: desired.length,
    inserts,
    updates,
    unchanged,
    changedIds: [...inserts, ...updates].map((topic) => topic.id).sort(),
  };
}

async function readTopics(client) {
  return (
    await client.query(
      `SELECT id,
              title,
              parent_id AS "parentId",
              status::text AS status,
              runtime_enabled AS "runtimeEnabled"
       FROM public.topics
       ORDER BY id`,
    )
  ).rows;
}

async function writeTopics(client, rows) {
  if (rows.length === 0) return 0;
  const result = await client.query(
    `INSERT INTO public.topics (id, title, parent_id, status, runtime_enabled)
     SELECT input.id, input.title, input.parent_id, input.status, input.runtime_enabled
     FROM unnest(
       $1::text[],
       $2::text[],
       $3::text[],
       $4::topic_status[],
       $5::boolean[]
     ) AS input(id, title, parent_id, status, runtime_enabled)
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title,
           parent_id = EXCLUDED.parent_id,
           status = EXCLUDED.status,
           runtime_enabled = EXCLUDED.runtime_enabled
     WHERE topics.title IS DISTINCT FROM EXCLUDED.title
        OR topics.parent_id IS DISTINCT FROM EXCLUDED.parent_id
        OR topics.status IS DISTINCT FROM EXCLUDED.status
        OR topics.runtime_enabled IS DISTINCT FROM EXCLUDED.runtime_enabled`,
    [
      rows.map((topic) => topic.id),
      rows.map((topic) => topic.title),
      rows.map((topic) => topic.parentId),
      rows.map((topic) => topic.status),
      rows.map((topic) => topic.runtimeEnabled),
    ],
  );
  return result.rowCount;
}

export async function syncTopics(
  client,
  desiredRows,
  {
    dryRun = true,
    expectedProjectionFingerprint,
    expectedPlanFingerprint,
    beforeVerification,
  } = {},
) {
  if (typeof dryRun !== 'boolean') throw new Error('dryRun must be a boolean');
  if (
    expectedProjectionFingerprint !== undefined &&
    (typeof expectedProjectionFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expectedProjectionFingerprint))
  ) {
    throw new Error('expectedProjectionFingerprint must be a lowercase SHA-256 digest');
  }
  if (
    expectedPlanFingerprint !== undefined &&
    (typeof expectedPlanFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(expectedPlanFingerprint))
  ) {
    throw new Error('expectedPlanFingerprint must be a lowercase SHA-256 digest');
  }
  const desired = normalizeDesiredTopics(desiredRows);
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '2min'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '2min'");
    const lock = await client.query(
      'SELECT pg_try_advisory_xact_lock($1, $2) AS locked',
      migrationLockKeys,
    );
    if (lock.rows[0]?.locked !== true) {
      throw new Error('Another database migration or Topic sync process currently holds the lock');
    }
    await client.query('LOCK TABLE public.topics IN SHARE ROW EXCLUSIVE MODE');

    const plan = planTopicSync(desired, await readTopics(client));
    if (
      expectedProjectionFingerprint !== undefined &&
      plan.fingerprint !== expectedProjectionFingerprint
    ) {
      throw new Error(
        `Topic projection fingerprint mismatch inside the locked transaction; reviewed ${expectedProjectionFingerprint}, generated ${plan.fingerprint}`,
      );
    }
    if (expectedPlanFingerprint !== undefined && plan.planFingerprint !== expectedPlanFingerprint) {
      throw new Error(
        `Topic sync plan fingerprint mismatch; reviewed ${expectedPlanFingerprint}, generated ${plan.planFingerprint}`,
      );
    }
    const changed = [...plan.inserts, ...plan.updates];
    const written = await writeTopics(client, changed);
    if (written !== changed.length) {
      throw new Error(`Topic sync wrote ${written} rows, but the plan required ${changed.length}`);
    }

    if (beforeVerification) await beforeVerification(client);
    const verification = planTopicSync(desired, await readTopics(client));
    if (verification.inserts.length > 0 || verification.updates.length > 0) {
      throw new Error(
        `Topic sync verification found residual drift: ${verification.changedIds.join(', ')}`,
      );
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
    transactionOpen = false;

    return {
      mode: dryRun ? 'dry-run' : 'apply',
      committed: !dryRun,
      fingerprint: plan.fingerprint,
      planFingerprint: plan.planFingerprint,
      desiredCount: plan.desiredCount,
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      unchanged: plan.unchanged.length,
      changedIds: plan.changedIds,
    };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function runTopicSync({
  connectionString,
  desiredTopics,
  dryRun = true,
  connectionTimeoutMillis = 10_000,
  beforeSync,
  beforeVerification,
  expectedProjectionFingerprint,
  expectedPlanFingerprint,
} = {}) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new Error('Topic sync database connection string is required');
  }
  const desired = normalizeDesiredTopics(desiredTopics);
  const client = new Client({
    connectionString,
    application_name: 'hzense-topic-sync',
    connectionTimeoutMillis,
  });
  await client.connect();
  try {
    if (beforeSync) await beforeSync(client);
    return await syncTopics(client, desired, {
      dryRun,
      expectedProjectionFingerprint,
      expectedPlanFingerprint,
      beforeVerification,
    });
  } finally {
    await client.end();
  }
}
