import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { automationStableId } from '../../../packages/database/src/automation-contract.mjs';
import { parseImportOutput } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { ImportIOError } from '../lib/import-io.ts';
import { runImportProcessing } from '../lib/import-worker-core.ts';
import {
  putLocalImportObject,
  readLocalImportObject,
  removeLocalImportObject,
} from '../lib/local-import-storage.ts';
import { parseLocalImport } from '../lib/local-import-parser.ts';

const failedRuns = [
  {
    runId: 'e56768a4-81b1-4c57-a5e6-3cd172c946c6',
    batchId: '83791f48-cf19-1567-7c26-db6848e3800e',
  },
  {
    runId: 'ab5b42f3-1b07-4a92-94d2-7fd1b849766a',
    batchId: '8216c294-47b2-3a28-fe9d-8868913d4c48',
  },
];
const itemId = 'a76c3048-16d3-4451-9e72-88df5f021fca';
const sourceUrl = 'https://source.invalid/synthetic-local-import';
const text = '# 合成导入资料\n\n这是一段用于本地解析回归的合成正文，没有真实凭据或付费调用。';
const bytes = Buffer.from(text);
const output = {
  fragments: [{ text, locator: { paragraph: 1 } }],
  warnings: [],
};

function environment(directory) {
  const url = (role) => `postgresql://${role}:${'a'.repeat(64)}@127.0.0.1:55432/hzense_local`;
  return {
    NODE_ENV: 'development',
    HZENSE_LOCAL_DEVELOPMENT: '1',
    PORT: '3000',
    NEXTAUTH_URL: 'http://127.0.0.1:3000',
    HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
    HZENSE_RUNTIME_EXPECTED_PORT: '55432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_RUNTIME_DATABASE_URL: url('hzense_runtime'),
    HZENSE_IMPORT_DATABASE_URL: url('hzense_import_admin'),
    HZENSE_IMPORT_ENABLED: '1',
    HZENSE_LOCAL_STATE_DIR: directory,
    // The opt-in Docker parser uses only the existing local CLI/image. No
    // provider, database or cloud credentials enter this synthetic environment.
    ...Object.fromEntries(
      ['PATH', 'HOME', 'TMPDIR', 'LANG'].flatMap((key) =>
        process.env[key] ? [[key, process.env[key]]] : [],
      ),
    ),
  };
}

async function files(directory) {
  try {
    return await readdir(join(directory, 'import-originals'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function fixture(t, failedRun, { fetchFails = false, parse = 'success' } = {}) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'hzense-local-import-worker-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '.hzense-local');
  await mkdir(directory, { mode: 0o700 });
  const env = environment(directory);
  const batchId = automationStableId({ runId: failedRun.runId, kind: 'import' });
  assert.equal(batchId, failedRun.batchId, 'Existing stable IDs must remain unchanged');
  const key = `imports/${batchId}/${itemId}`;
  const state = { events: [], document: null, completions: [], cleanupPending: 0 };
  const deps = {
    async expire() {
      state.events.push('expire');
    },
    async claim() {
      state.events.push('claim');
      return {
        item: { id: itemId, kind: 'url', declaration: { url: sourceUrl } },
        attempt: { fence: 1 },
        document: null,
      };
    },
    async fetch(url) {
      state.events.push('fetch');
      assert.equal(url, sourceUrl);
      if (fetchFails) throw new ImportIOError('fetch_failed');
      return { bytes, format: 'markdown' };
    },
    async put(path, value) {
      state.events.push('put');
      assert.equal(path, key);
      return putLocalImportObject(path, value, env);
    },
    async read(path) {
      state.events.push('read');
      assert.equal(path, key);
      return readLocalImportObject(path, env);
    },
    async confirm(document, fence) {
      state.events.push('confirm');
      assert.equal(fence, 1);
      assert.deepEqual(document, {
        object_key: key,
        object_version: `sha256-${createHash('sha256').update(bytes).digest('hex')}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byte_size: bytes.length,
        format: 'markdown',
      });
      state.document = document;
    },
    async parse(value, format) {
      state.events.push('parse');
      assert.ok(state.document, 'Persist the immutable document receipt before parsing');
      assert.deepEqual(value, bytes);
      assert.equal(format, 'markdown');
      assert.equal((await files(directory)).length, 1);
      if (parse === 'failed') throw new ImportIOError('parse_failed');
      if (parse === 'invalid') return { fragments: [] };
      if (parse === 'docker') return parseLocalImport(value, format, env);
      return output;
    },
    async remove(path) {
      state.events.push('remove');
      assert.equal(path, key);
      return removeLocalImportObject(path, env);
    },
    cleanupFailed() {
      state.cleanupPending++;
    },
    async finish(completion) {
      state.events.push('finish');
      assert.deepEqual(
        await files(directory),
        [],
        'Original bytes must be removed before committing the terminal task state',
      );
      if (completion.output) parseImportOutput(completion.output);
      state.completions.push(completion);
      return { item_id: itemId, status: completion.outcome };
    },
  };
  return { directory, env, key, state, deps };
}

test('stable automation batch IDs complete URL import using actual local storage and cleanup', async (t) => {
  for (const failedRun of failedRuns)
    await t.test(failedRun.runId, async (t) => {
      const { directory, state, deps, key } = await fixture(t, failedRun);
      const result = await runImportProcessing(key, 0, deps);
      assert.equal(result.status, 'completed');
      assert.equal(result.original_cleanup, 'deleted');
      assert.deepEqual(state.completions, [
        { fence: 1, outcome: 'completed', output, chargedMicrousd: 0 },
      ]);
      assert.equal(state.cleanupPending, 0);
      assert.deepEqual(await files(directory), []);
      assert.deepEqual(state.events, [
        'expire',
        'claim',
        'fetch',
        'put',
        'read',
        'confirm',
        'read',
        'parse',
        'remove',
        'finish',
      ]);
    });
});

test('stable automation batch IDs clean original bytes after parser failures or invalid output', async (t) => {
  for (const failedRun of failedRuns)
    for (const parse of ['failed', 'invalid'])
      await t.test(`${failedRun.runId} / ${parse}`, async (t) => {
        const { directory, state, deps, key } = await fixture(t, failedRun, { parse });
        const result = await runImportProcessing(key, 0, deps);
        assert.equal(result.status, 'failed');
        assert.equal(result.original_cleanup, 'deleted');
        assert.ok(state.document);
        assert.deepEqual(state.completions, [
          { fence: 1, outcome: 'failed', errorCode: 'parse_failed', chargedMicrousd: 0 },
        ]);
        assert.equal(state.cleanupPending, 0);
        assert.deepEqual(await files(directory), []);
        assert.deepEqual(state.events.slice(-3), ['parse', 'remove', 'finish']);
      });
});

test('failed URL fetch cleans an absent local original idempotently without masking the failure', async (t) => {
  for (const failedRun of failedRuns)
    await t.test(failedRun.runId, async (t) => {
      const { directory, env, state, deps, key } = await fixture(t, failedRun, {
        fetchFails: true,
      });
      const result = await runImportProcessing(key, 0, deps);
      assert.equal(result.status, 'failed');
      assert.equal(result.original_cleanup, 'deleted');
      assert.equal(state.document, null);
      assert.deepEqual(state.completions, [
        { fence: 1, outcome: 'failed', errorCode: 'fetch_failed', chargedMicrousd: 0 },
      ]);
      assert.equal(state.cleanupPending, 0);
      assert.deepEqual(state.events, ['expire', 'claim', 'fetch', 'remove', 'finish']);
      await removeLocalImportObject(key, env);
      await removeLocalImportObject(key, env);
      assert.deepEqual(await files(directory), []);
    });
});

test(
  'opt-in Docker parser completes the same stable-ID URL import without cloud dependencies',
  { skip: process.env.HZENSE_LOCAL_IMPORT_DOCKER_TEST !== '1' },
  async (t) => {
    for (const failedRun of failedRuns)
      await t.test(failedRun.runId, async (t) => {
        const { directory, state, deps, key } = await fixture(t, failedRun, { parse: 'docker' });
        const result = await runImportProcessing(key, 0, deps);
        assert.equal(result.status, 'completed');
        assert.equal(result.original_cleanup, 'deleted');
        assert.equal(state.completions.length, 1);
        const parsed = parseImportOutput(state.completions[0].output);
        assert.match(parsed.fragments.map((fragment) => fragment.text).join('\n'), /合成导入资料/);
        assert.equal(state.cleanupPending, 0);
        assert.deepEqual(await files(directory), []);
      });
  },
);
