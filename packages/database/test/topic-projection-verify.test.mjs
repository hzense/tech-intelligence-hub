import console from 'node:console';
import { describe, expect, it, vi } from 'vitest';
import {
  authoritativeTopicCount,
  runTopicProjectionVerification,
  runTopicProjectionVerifyCommand,
  verifyTopicProjectionReadOnly,
  verifyTopicProjectionRows,
} from '../src/topic-projection-verify.mjs';
import { topicProjectionFingerprint } from '../src/topic-sync.mjs';

function authoritativeTopics() {
  return Array.from({ length: authoritativeTopicCount }, (_, index) => ({
    id: `topic-verify-${String(index + 1).padStart(3, '0')}`,
    title: `Topic ${index + 1}`,
    parentId: null,
    status: index < 5 ? 'active' : 'watching',
    runtimeEnabled: index < 5,
  }));
}

function readOnlyClient(databaseRows) {
  const query = vi.fn(async (sql) => {
    if (sql.includes('FROM public.topics')) {
      return { rowCount: databaseRows.length, rows: databaseRows };
    }
    return { rowCount: 0, rows: [] };
  });
  return { query };
}

const productionEnvironment = (fingerprint) => ({
  HZENSE_TOPIC_SYNC_DATABASE_URL:
    'postgresql://hzense_topic_sync:secret@db.example.com:5432/hzense?sslmode=verify-full',
  HZENSE_TOPIC_SYNC_EXPECTED_HOST: 'db.example.com',
  HZENSE_TOPIC_SYNC_EXPECTED_PORT: '5432',
  HZENSE_TOPIC_SYNC_EXPECTED_NAME: 'hzense',
  HZENSE_TOPIC_SYNC_EXPECTED_USER: 'hzense_topic_sync',
  HZENSE_TOPIC_SYNC_EXPECTED_POSTGRES_MAJOR: '18',
  HZENSE_TOPIC_SYNC_EXPECTED_CONNECTION_LIMIT: '2',
  HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT: fingerprint,
});

describe('read-only Topic projection verification', () => {
  it('strictly verifies all 62 managed fields and the reviewed source fingerprint', () => {
    const topics = authoritativeTopics();
    const fingerprint = topicProjectionFingerprint(topics);

    expect(
      verifyTopicProjectionRows(topics, [...topics].reverse(), {
        expectedFingerprint: fingerprint,
      }),
    ).toEqual({
      verified: true,
      topicCount: 62,
      unknownTopicCount: 0,
      fingerprint,
    });
  });

  it('fails closed on source-fingerprint drift, unknown IDs, missing IDs and field drift', () => {
    const topics = authoritativeTopics();
    const fingerprint = topicProjectionFingerprint(topics);
    const wrongFingerprint = 'f'.repeat(64) === fingerprint ? 'e'.repeat(64) : 'f'.repeat(64);

    expect(() =>
      verifyTopicProjectionRows(topics, topics, { expectedFingerprint: wrongFingerprint }),
    ).toThrow(/Authoritative Topic projection fingerprint mismatch/);

    const unknown = [...topics.slice(0, -1), { ...topics.at(-1), id: 'topic-unknown' }];
    expect(() =>
      verifyTopicProjectionRows(topics, unknown, { expectedFingerprint: fingerprint }),
    ).toThrow(/outside authoritative Taxonomy: topic-unknown/);

    expect(() =>
      verifyTopicProjectionRows(topics, topics.slice(0, -1), { expectedFingerprint: fingerprint }),
    ).toThrow(/Database is missing 1 authoritative Topic ID/);

    const drifted = topics.map((topic, index) =>
      index === 0 ? { ...topic, title: 'Drifted title' } : topic,
    );
    expect(() =>
      verifyTopicProjectionRows(topics, drifted, { expectedFingerprint: fingerprint }),
    ).toThrow(/topic-verify-001:title/);
  });

  it('requires the complete 62-Topic authority set and a reviewed digest', () => {
    const topics = authoritativeTopics();

    expect(() =>
      verifyTopicProjectionRows(topics.slice(0, -1), topics.slice(0, -1), {
        expectedFingerprint: topicProjectionFingerprint(topics.slice(0, -1)),
      }),
    ).toThrow(/exactly 62 Topics; found 61/);
    expect(() =>
      verifyTopicProjectionRows(topics, topics, { expectedFingerprint: 'not-a-digest' }),
    ).toThrow(/lowercase SHA-256 digest/);
  });

  it('uses one READ ONLY transaction, SELECTs once and executes no DML', async () => {
    const topics = authoritativeTopics();
    const fingerprint = topicProjectionFingerprint(topics);
    const client = readOnlyClient(topics);
    const beforeRead = vi.fn();

    await expect(
      verifyTopicProjectionReadOnly(client, topics, {
        expectedFingerprint: fingerprint,
        beforeRead,
      }),
    ).resolves.toMatchObject({ verified: true, topicCount: 62 });

    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe('BEGIN READ ONLY');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(beforeRead).toHaveBeenCalledOnce();
    expect(statements.filter((sql) => sql.includes('FROM public.topics'))).toHaveLength(1);
    expect(statements.join('\n')).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|MERGE|COPY|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i,
    );
  });

  it('rolls back the read-only transaction when verification fails', async () => {
    const topics = authoritativeTopics();
    const fingerprint = topicProjectionFingerprint(topics);
    const client = readOnlyClient(topics.slice(0, -1));

    await expect(
      verifyTopicProjectionReadOnly(client, topics, { expectedFingerprint: fingerprint }),
    ).rejects.toThrow(/Database is missing/);
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });

  it('creates and closes an independent verifier connection with bounded connect time', async () => {
    const topics = authoritativeTopics();
    const fingerprint = topicProjectionFingerprint(topics);
    const client = { ...readOnlyClient(topics), connect: vi.fn(), end: vi.fn() };
    const createClient = vi.fn(() => client);

    await expect(
      runTopicProjectionVerification({
        connectionString: 'postgresql://verifier:secret@127.0.0.1:5432/hzense',
        expectedTopics: topics,
        expectedFingerprint: fingerprint,
        createClient,
      }),
    ).resolves.toMatchObject({ verified: true });
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        application_name: 'hzense-topic-projection-verify',
        connectionTimeoutMillis: 10_000,
      }),
    );
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('wires the production identity preflight inside READ ONLY mode without logging secrets', async () => {
    const topics = authoritativeTopics();
    const fingerprint = topicProjectionFingerprint(topics);
    const inspectTopicSyncPreflight = vi.fn();
    let execution;
    const runTopicProjectionVerification = vi.fn(async (options) => {
      execution = options;
      return { verified: true, topicCount: 62, unknownTopicCount: 0, fingerprint };
    });
    const content = {
      loadContent: vi.fn(),
      loadSeedCatalog: vi.fn().mockResolvedValue({ taxonomy: {}, topics: [] }),
      buildTopicDatabaseProjection: vi.fn().mockReturnValue(topics),
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(
        runTopicProjectionVerifyCommand({
          environment: productionEnvironment(fingerprint),
          dependencies: { content, inspectTopicSyncPreflight, runTopicProjectionVerification },
        }),
      ).resolves.toMatchObject({ verified: true, topicCount: 62 });
      await execution.beforeRead({ query: vi.fn() });
    } finally {
      log.mockRestore();
    }

    expect(runTopicProjectionVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedTopics: topics,
        expectedFingerprint: fingerprint,
        expectedCount: 62,
      }),
    );
    expect(inspectTopicSyncPreflight).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedDatabase: 'hzense',
        expectedUser: 'hzense_topic_sync',
        expectedTransactionReadOnly: true,
        profile: 'production',
      }),
    );
    const output = log.mock.calls.flat().join(' ');
    expect(output).not.toContain('secret');
    expect(output).not.toContain('postgresql://');
  });

  it('rejects arguments and stale reviewed fingerprints before opening a connection', async () => {
    const topics = authoritativeTopics();
    const dependencies = {
      content: {
        loadContent: vi.fn(),
        loadSeedCatalog: vi.fn().mockResolvedValue({ taxonomy: {}, topics: [] }),
        buildTopicDatabaseProjection: vi.fn().mockReturnValue(topics),
      },
      runTopicProjectionVerification: vi.fn(),
    };

    await expect(
      runTopicProjectionVerifyCommand({ arguments: ['--apply'], dependencies }),
    ).rejects.toThrow(/does not accept command-line arguments/);
    await expect(
      runTopicProjectionVerifyCommand({
        environment: productionEnvironment('a'.repeat(64)),
        dependencies,
      }),
    ).rejects.toThrow(/Authoritative Topic projection fingerprint mismatch/);
    expect(dependencies.runTopicProjectionVerification).not.toHaveBeenCalled();
  });
});
