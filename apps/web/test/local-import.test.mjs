import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  realpath,
  readdir,
  rm,
  symlink,
  chmod,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  putLocalImportObject,
  readLocalImportObject,
  removeLocalImportObject,
} from '../lib/local-import-storage.ts';
import { localParserArguments, parseLocalImport } from '../lib/local-import-parser.ts';
import { diagnoseImportConfiguration } from '../lib/import-config.ts';
import { importParserSource } from '../../../packages/ingestion/src/import-parser-source.mjs';
import { importUuid } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { automationStableId } from '../../../packages/database/src/automation-contract.mjs';

const key = 'imports/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
const secret = 'a'.repeat(64);
function environment(directory = '/synthetic/.hzense-local') {
  return {
    NODE_ENV: 'development',
    HZENSE_LOCAL_DEVELOPMENT: '1',
    PORT: '3000',
    NEXTAUTH_URL: 'http://127.0.0.1:3000',
    HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
    HZENSE_RUNTIME_EXPECTED_PORT: '55432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_RUNTIME_DATABASE_URL: `postgresql://hzense_runtime:${secret}@127.0.0.1:55432/hzense_local`,
    HZENSE_IMPORT_DATABASE_URL: `postgresql://hzense_import_admin:${secret}@127.0.0.1:55432/hzense_local`,
    HZENSE_IMPORT_ENABLED: '1',
    HZENSE_LOCAL_STATE_DIR: directory,
  };
}
async function fixture(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'hzense-import-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '.hzense-local');
  await mkdir(directory, { mode: 0o700 });
  return { root, directory, env: environment(directory) };
}
test('local originals are immutable, hash-checked, private and removed on completion', async (t) => {
  const { directory, env } = await fixture(t);
  const bytes = Buffer.from('本地合成资料，不含真实秘密。');
  const receipt = await putLocalImportObject(key, bytes, env);
  assert.equal(receipt.sha256, createHash('sha256').update(bytes).digest('hex'));
  const actual = await readLocalImportObject(key, env);
  assert.deepEqual(actual.bytes, bytes);
  assert.equal(actual.version, receipt.version);
  await putLocalImportObject(key, bytes, env);
  await assert.rejects(putLocalImportObject(key, Buffer.from('different'), env), {
    code: 'document_conflict',
  });
  assert.equal((await readdir(join(directory, 'import-originals'))).length, 1);
  await removeLocalImportObject(key, env);
  assert.deepEqual(await readdir(join(directory, 'import-originals')), []);
  await removeLocalImportObject(key, env);
  await assert.rejects(readLocalImportObject(key, env), { code: 'source_unavailable' });
});
test('local originals accept the unchanged stable automation IDs and all import UUID nibbles', async (t) => {
  const { directory, env } = await fixture(t);
  const cases = [
    ['e56768a4-81b1-4c57-a5e6-3cd172c946c6', '83791f48-cf19-1567-7c26-db6848e3800e'],
    ['ab5b42f3-1b07-4a92-94d2-7fd1b849766a', '8216c294-47b2-3a28-fe9d-8868913d4c48'],
  ].map(([runId, expected]) => {
    const id = automationStableId({ runId, kind: 'import' });
    assert.equal(id, expected);
    return id;
  });
  for (const nibble of '0123456789abcdef') {
    cases.push(`11111111-1111-${nibble}111-8111-111111111111`);
    cases.push(`11111111-1111-4111-${nibble}111-111111111111`);
  }
  for (const id of cases) {
    assert.equal(importUuid(id), id);
    // Both path segments use the same record-ID contract, not an RFC variant rule.
    const path = `imports/${id}/${id}`;
    const bytes = Buffer.from(`synthetic original for ${id}`);
    const receipt = await putLocalImportObject(path, bytes, env);
    assert.deepEqual((await readLocalImportObject(path, env)).bytes, bytes);
    assert.equal(receipt.sha256, createHash('sha256').update(bytes).digest('hex'));
    await putLocalImportObject(path, bytes, env);
    await assert.rejects(putLocalImportObject(path, Buffer.from('changed'), env), {
      code: 'document_conflict',
    });
    await removeLocalImportObject(path, env);
    await removeLocalImportObject(path, env);
    await assert.rejects(readLocalImportObject(path, env), { code: 'source_unavailable' });
  }
  assert.deepEqual(await readdir(join(directory, 'import-originals')), []);
});
test('local object keys reject malformed segments for writes, reads and cleanup before filesystem access', async () => {
  const env = environment();
  const [, batch, item] = key.split('/');
  const invalidKeys = [
    '',
    `/${key}`,
    `other/${batch}/${item}`,
    `imports//${batch}/${item}`,
    `imports/${batch}`,
    `${key}/`,
    `${key}/extra`,
    `${key}\n`,
    `${key}\r\n`,
    `${key}\0`,
    `${key}?query=1`,
    `${key}#fragment`,
    `${key} `,
    `imports/${batch}\n/${item}`,
    `imports/${batch}/../${item}`,
    `imports/${batch}/%2e%2e`,
    key.replaceAll('/', '\\'),
    `imports/${batch.slice(1)}/${item}`,
    `imports/${batch}/${item.slice(1)}`,
    `imports/${batch}/${item.replace(/2$/, 'g')}`,
    'imports/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA/22222222-2222-4222-8222-222222222222',
    'imports/11111111-1111-4111-8111-111111111111/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  ];
  for (const path of invalidKeys) {
    await assert.rejects(putLocalImportObject(path, Buffer.from('synthetic'), env), {
      code: 'invalid_request',
    });
    await assert.rejects(readLocalImportObject(path, env), { code: 'invalid_request' });
    await assert.rejects(removeLocalImportObject(path, env), { code: 'invalid_request' });
  }
});
test('local upload rejects cloud contexts, arbitrary paths, symbolic links and permissive directories', async (t) => {
  const { directory, root, env } = await fixture(t);
  const bytes = Buffer.from('synthetic');
  for (const bad of [
    { ...env, NODE_ENV: 'production' },
    { ...env, VERCEL: '1' },
    { ...env, HZENSE_LOCAL_DEVELOPMENT: '0' },
  ])
    await assert.rejects(putLocalImportObject(key, bytes, bad), { code: 'not_configured' });
  await assert.rejects(putLocalImportObject('../../outside', bytes, env), {
    code: 'invalid_request',
  });
  await symlink(root, join(directory, 'import-originals'));
  await assert.rejects(putLocalImportObject(key, bytes, env), { code: 'document_conflict' });
  await rm(join(directory, 'import-originals'));
  await chmod(directory, 0o755);
  await assert.rejects(putLocalImportObject(key, bytes, env), { code: 'document_conflict' });
});
test('local readers reject swapped files and byte tampering instead of accepting a fresh etag', async (t) => {
  const { root, directory, env } = await fixture(t);
  await putLocalImportObject(key, Buffer.from('synthetic'), env);
  const path = join(directory, 'import-originals', createHash('sha256').update(key).digest('hex'));
  const original = await readFile(path);
  assert.equal(original.includes(Buffer.from('synthetic')), true);
  const tampered = Buffer.from(original);
  tampered[tampered.length - 1] ^= 1;
  await writeFile(path, tampered);
  await assert.rejects(readLocalImportObject(key, env), { code: 'document_conflict' });
  await writeFile(path, original);
  await rm(path);
  await symlink(join(root, 'outside'), path);
  await assert.rejects(readLocalImportObject(key, env), { code: 'document_conflict' });
  await assert.rejects(removeLocalImportObject(key, env), { code: 'document_conflict' });
});
test('expired temporary originals cannot be parsed but can be safely cleaned', async (t) => {
  const { directory, env } = await fixture(t);
  await putLocalImportObject(key, Buffer.from('synthetic'), env);
  const path = join(directory, 'import-originals', createHash('sha256').update(key).digest('hex'));
  const original = await readFile(path);
  const length = original.readUInt32BE(0);
  const receipt = JSON.parse(original.subarray(4, 4 + length).toString());
  receipt.uploadedAt -= 25 * 60 * 60 * 1000;
  const updated = Buffer.from(JSON.stringify(receipt));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(updated.length);
  await writeFile(path, Buffer.concat([prefix, updated, original.subarray(4 + length)]));
  await assert.rejects(readLocalImportObject(key, env), { code: 'source_expired' });
  await removeLocalImportObject(key, env);
  assert.deepEqual(await readdir(join(directory, 'import-originals')), []);
});
test('local diagnostics do not require or impersonate Blob and Sandbox credentials', () => {
  const result = diagnoseImportConfiguration(environment());
  assert.deepEqual(result, { enabled: true, valid: true, ready: true, issues: [] });
  assert.equal(
    diagnoseImportConfiguration({ ...environment(), HZENSE_IMPORT_ENABLED: '0' }).ready,
    false,
  );
  assert.equal(
    diagnoseImportConfiguration({ ...environment(), VERCEL_ENV: 'production' }).ready,
    false,
  );
  assert.equal(
    diagnoseImportConfiguration({ ...environment(), HZENSE_IMPORT_DATABASE_URL: undefined }).ready,
    false,
  );
});

const imageId = `sha256:${'b'.repeat(64)}`;
const image = [
  {
    Id: imageId,
    Os: 'linux',
    Config: {
      User: '65532:65532',
      Labels: { 'org.hzense.local-parser': '1' },
      Entrypoint: ['python3', '-I', '/opt/hzense/import-runner.py'],
    },
  },
];
const contexts = [
  { Name: 'desktop-linux', Endpoints: { docker: { Host: 'unix:///synthetic/docker.sock' } } },
];
test('parser uses isolated immutable image, same algorithm, no mounts or cloud secrets and guaranteed cleanup', async () => {
  const calls = [];
  const output = { fragments: [{ text: 'synthetic', locator: { paragraph: 1 } }], warnings: [] };
  const result = await parseLocalImport(
    Buffer.from('synthetic'),
    'text',
    environment(),
    async (args, input) => {
      calls.push(args);
      if (args[0] === 'context') return JSON.stringify(contexts);
      if (args.includes('inspect')) return JSON.stringify(image);
      if (args.includes('run')) {
        const packet = JSON.parse(input.toString());
        assert.equal(packet.parser, importParserSource);
        assert.equal(packet.format, 'text');
        assert.equal(Buffer.from(packet.content, 'base64').toString(), 'synthetic');
        assert.ok(args.includes('--read-only'));
        assert.ok(args.includes('no-new-privileges:true'));
        assert.equal(args[args.indexOf('--network') + 1], 'none');
        assert.equal(args.at(-1), imageId);
        assert.equal(
          args.some((arg) => ['--mount', '-v', '--volume', '-e'].includes(arg)),
          false,
        );
        assert.deepEqual(
          args.flatMap((arg, index) => (arg === '--env' ? [args[index + 1]] : [])),
          [
            'HTTP_PROXY=',
            'HTTPS_PROXY=',
            'ALL_PROXY=',
            'NO_PROXY=',
            'FTP_PROXY=',
            'http_proxy=',
            'https_proxy=',
            'all_proxy=',
            'no_proxy=',
            'ftp_proxy=',
          ],
        );
        return JSON.stringify({ output });
      }
      return '';
    },
  );
  assert.deepEqual(result, output);
  assert.ok(calls.at(-1).includes('rm'));
});
test('parser rejects remote contexts and missing isolation provenance before execution', async () => {
  const calls = [];
  await assert.rejects(
    parseLocalImport(Buffer.from('synthetic'), 'text', environment(), async (args) => {
      calls.push(args);
      return JSON.stringify([{ Name: 'remote', Endpoints: { docker: { Host: 'ssh://remote' } } }]);
    }),
    { code: 'not_configured' },
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    parseLocalImport(Buffer.from('synthetic'), 'text', environment(), async (args) =>
      JSON.stringify(
        args[0] === 'context'
          ? contexts
          : [{ ...image[0], Config: { ...image[0].Config, Volumes: { '/host': {} } } }],
      ),
    ),
    { code: 'not_configured' },
  );
  assert.throws(() => localParserArguments('desktop-linux', 'latest', 'untrusted'), {
    code: 'not_configured',
  });
});
test('parser forcibly removes its specific container after malformed output or timeout', async () => {
  const calls = [];
  await assert.rejects(
    parseLocalImport(Buffer.from('synthetic'), 'text', environment(), async (args) => {
      calls.push(args);
      if (args[0] === 'context') return JSON.stringify(contexts);
      if (args.includes('inspect')) return JSON.stringify(image);
      if (args.includes('run')) return 'not-json';
      return '';
    }),
    { code: 'parse_failed' },
  );
  assert.ok(calls.at(-1).includes('rm'));
  assert.equal(
    calls.at(-1).at(-1),
    calls.find((args) => args.includes('run'))[
      calls.find((args) => args.includes('run')).indexOf('--name') + 1
    ],
  );
});
