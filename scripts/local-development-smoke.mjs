import { Buffer } from 'node:buffer';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL, URLSearchParams } from 'node:url';
import { assertLocalDatabaseExecution } from './local-database.mjs';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mockProfile = '1389674e-ea29-4a37-a563-073f498fb7f2';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export class LocalSmokeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LocalSmokeError';
    this.code = code;
  }
}
const requireCheck = (condition, code) => {
  if (!condition) throw new LocalSmokeError(code);
};

export function parseLocalSmokeArguments(args) {
  let port = 3000;
  const seen = new Set();
  for (const arg of args) {
    const separator = arg.indexOf('=');
    const key = arg.slice(0, separator),
      value = arg.slice(separator + 1);
    requireCheck(separator > 0 && !seen.has(key), 'invalid_arguments');
    seen.add(key);
    if (key === '--port') {
      requireCheck(
        /^[1-9][0-9]{3,4}$/.test(value) && Number(value) <= 65535 && Number(value) >= 1024,
        'invalid_port',
      );
      port = Number(value);
    } else throw new LocalSmokeError('unsupported_argument');
  }
  return { port, origin: `http://127.0.0.1:${port}` };
}

export function buildLocalSmokeFixture(source, suffix) {
  requireCheck(/^[a-f0-9]{12}$/.test(suffix), 'invalid_fixture_id');
  requireCheck(
    source.includes('HZense 本地联调资料') && (source.match(/^标题：/gm) ?? []).length === 1,
    'invalid_fixture',
  );
  const modified = source.replace(/^标题：(.+)$/m, (_line, title) => `标题：${title} ${suffix}`);
  const title = `【本地模拟】${modified.match(/^标题：(.+)$/m)[1]}`;
  requireCheck(Array.from(title).length <= 80, 'fixture_title_too_long');
  return { bytes: Buffer.from(modified), title, suffix };
}

async function privateDirectory(path) {
  const info = await lstat(path);
  requireCheck(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid?.() &&
      (info.mode & 0o777) === 0o700 &&
      (await realpath(path)) === path,
    'unsafe_state_directory',
  );
}

export function createLocalSmokeClient(origin, fetcher = globalThis.fetch) {
  requireCheck(
    /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(origin) &&
      new URL(origin).port !== '' &&
      Number(new URL(origin).port) >= 1024,
    'invalid_origin',
  );
  async function request(
    path,
    { method = 'GET', json, body, type, expectStatus = 200, timeout = 120000, authorityProbe } = {},
  ) {
    const url = new URL(path, origin);
    requireCheck(
      url.origin === origin &&
        path.startsWith('/') &&
        !path.startsWith('//') &&
        !url.hash &&
        !url.username &&
        !url.password,
      'nonlocal_request',
    );
    const headers = {
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      'Cache-Control': 'no-cache',
    };
    if (authorityProbe !== undefined) {
      requireCheck(
        method === 'GET' && ['forwarded-host', 'origin'].includes(authorityProbe),
        'invalid_authority_probe',
      );
      // Change only request headers, never the literal-loopback socket destination.
      // Node fetch normalizes Host; use an explicitly rejected forwarded authority instead.
      if (authorityProbe === 'forwarded-host') headers['X-Forwarded-Host'] = 'not-local.invalid';
      else headers.Origin = 'https://not-local.invalid';
    }
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (type) headers['Content-Type'] = type;
    let response;
    try {
      response = await fetcher(url, {
        method,
        headers,
        body,
        credentials: 'omit',
        redirect: 'manual',
        cache: 'no-store',
        signal: globalThis.AbortSignal.timeout(timeout),
      });
    } catch {
      throw new LocalSmokeError('http_outcome_unknown_no_retry');
    }
    requireCheck(!response.url || new URL(response.url).origin === origin, 'nonlocal_response');
    // Authentication is not used in strict local mode. Never retain or replay a cookie.
    requireCheck(response.status < 300 || response.status >= 400, 'redirect_refused');
    const text = await response.text();
    requireCheck(Buffer.byteLength(text) <= 12 * 1024 * 1024, 'response_too_large');
    let data;
    if (response.headers.get('content-type')?.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new LocalSmokeError('invalid_json_response');
      }
    }
    const expectedStatuses = Array.isArray(expectStatus) ? expectStatus : [expectStatus];
    if (!expectedStatuses.includes(response.status)) {
      const code =
        typeof data?.error === 'string' && /^[a-z_]{1,48}$/.test(data.error)
          ? data.error
          : 'unexpected_status';
      throw new LocalSmokeError(`http_${response.status}_${code}`);
    }
    return { status: response.status, text, data };
  }
  return { request, json: async (path, options) => (await request(path, options)).data };
}

export async function verifyLocalSmokeBoundary(api) {
  const health = await api.json('/api/health/database');
  requireCheck(health?.status === 'ok', 'local_database_unhealthy');
  for (const authorityProbe of ['forwarded-host', 'origin']) {
    await api.request('/api/admin/signal-generation', { authorityProbe, expectStatus: [401, 403] });
  }
}

export async function runLocalDevelopmentSmoke({
  args = process.argv.slice(2),
  root = rootDirectory,
  environment = process.env,
  log = console.log,
} = {}) {
  assertLocalDatabaseExecution(environment);
  requireCheck(
    ![
      'NODE_OPTIONS',
      'NODE_USE_ENV_PROXY',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ].some((key) => environment[key]),
    'proxy_or_node_override_refused',
  );
  const { origin } = parseLocalSmokeArguments(args);
  const stateDirectory = resolve(root, '.hzense-local');
  await privateDirectory(stateDirectory);
  const suffix = randomBytes(6).toString('hex');
  const receiptPath = resolve(stateDirectory, `smoke-${suffix}.json`);
  const state = {
    version: 1,
    id: suffix,
    origin,
    scope: 'local-fictional-fixture-only',
    stage: 'preflight',
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  await writeFile(receiptPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  async function checkpoint(stage, values = {}) {
    Object.assign(state, values, { stage });
    const file = await open(receiptPath, constants.O_WRONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      requireCheck(
        info.isFile() &&
          info.nlink === 1 &&
          info.uid === process.getuid?.() &&
          (info.mode & 0o777) === 0o600,
        'unsafe_receipt_file',
      );
      await file.truncate(0);
      await file.writeFile(`${JSON.stringify(state, null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    const ids = Object.entries(values)
      .filter(
        ([key, value]) =>
          key.endsWith('Id') &&
          typeof value === 'string' &&
          (uuid.test(value) || /^editorial-[a-f0-9]{32}$/.test(value)),
      )
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    log(`[local-smoke] ${stage}${values.status ? ` ${values.status}` : ''}${ids ? ` ${ids}` : ''}`);
  }
  const api = createLocalSmokeClient(origin);
  const post = (path, json, options) => api.json(path, { method: 'POST', json, ...options });
  try {
    await verifyLocalSmokeBoundary(api);
    await checkpoint('local_health_and_authority_checked');
    const dashboard = await api.json('/api/admin/signal-generation');
    const profile = dashboard?.profiles?.find((item) => item.id === mockProfile);
    requireCheck(
      profile?.revision === 1 &&
        profile.readiness?.ready === true &&
        profile.name === '本地模拟 · 无 AI 调用 · 非真实模型' &&
        profile.provider_host === '本地模拟（不联网）',
      'mock_profile_required',
    );
    await checkpoint('local_identity_and_mock_profile_verified');

    const fixture = buildLocalSmokeFixture(
      await readFile(resolve(root, 'docs/fixtures/local-signal.md'), 'utf8'),
      suffix,
    );
    const batchId = randomUUID();
    await checkpoint('create_import_once', { batchId });
    const batch = await post('/api/admin/imports', {
      action: 'create',
      request: {
        id: batchId,
        intent: 'preview',
        manifest: {
          files: [
            {
              clientItemId: 'file-0',
              name: `local-signal-${suffix}.md`,
              size: fixture.bytes.length,
            },
          ],
          urlLines: '',
        },
      },
    });
    requireCheck(
      batch?.id === batchId &&
        batch.items?.length === 1 &&
        uuid.test(batch.items[0].id) &&
        batch.items[0].status === 'awaiting_upload',
      'unexpected_import_batch',
    );
    const itemId = batch.items[0].id;
    await checkpoint('upload_once', { itemId });
    await api.json(`/api/admin/imports/upload?${new URLSearchParams({ batchId, itemId })}`, {
      method: 'POST',
      type: 'application/octet-stream',
      body: fixture.bytes,
    });
    await checkpoint('confirm_upload_once');
    await post('/api/admin/imports', { action: 'confirm', batchId, itemId });
    await checkpoint('parse_once');
    const parsed = await post(
      '/api/admin/imports',
      { action: 'run', batchId, itemId },
      { timeout: 180000 },
    );
    requireCheck(parsed?.original_cleanup === 'deleted', 'original_cleanup_not_confirmed');
    const reread = await post('/api/admin/imports', { action: 'detail', batchId });
    requireCheck(
      reread.items?.find((item) => item.id === itemId)?.status === 'completed',
      'import_not_completed',
    );
    const output = await post('/api/admin/imports', { action: 'output', batchId, itemId });
    requireCheck(JSON.stringify(output).includes(suffix), 'parsed_fixture_not_found');
    await checkpoint('import_parsed_original_deleted');

    const runId = randomUUID();
    await checkpoint('create_generation_once', { runId });
    const created = await post('/api/admin/signal-generation', {
      action: 'create',
      id: runId,
      batchId,
      itemId,
      profileId: mockProfile,
      profileRevision: 1,
      consent: true,
    });
    requireCheck(
      created?.run?.id === runId && created.run.status === 'pending',
      'generation_not_pending',
    );
    await checkpoint('enqueue_generation_once');
    await post('/api/admin/signal-generation', { action: 'run', id: runId }, { expectStatus: 202 });
    const deadline = Date.now() + 5 * 60 * 1000;
    let run;
    while (Date.now() < deadline) {
      ({ run } = await api.json(`/api/admin/signal-generation?id=${runId}`));
      requireCheck(run?.id === runId, 'generation_identity_mismatch');
      if (run.status === 'completed') break;
      requireCheck(
        ['pending', 'running'].includes(run.status),
        `generation_${/^[a-z_]{1,48}$/.test(run.error_code ?? '') ? run.error_code : 'failed'}`,
      );
      await delay(1000);
    }
    requireCheck(
      run?.status === 'completed' &&
        run.result?.candidates?.length === 1 &&
        run.result.candidates[0].title === fixture.title,
      'generation_result_not_confirmed',
    );
    // The unchanged task store keeps a minimum one-microdollar estimate. This
    // simulated bookkeeping is not a supplier call or a provider bill.
    requireCheck(Number(run.charged_microusd) === 1, 'mock_generation_estimate_unexpected');
    await checkpoint('mock_generation_completed_no_provider_call', { simulatedLedgerMicrousd: 1 });

    const editorialPath = `/api/admin/editorial-signals?runId=${runId}&candidateIndex=0`;
    const review = await api.json(editorialPath);
    requireCheck(
      review?.configured === true &&
        review.revision === 0 &&
        review.content?.title === fixture.title &&
        review.sourceOptions?.length > 0,
      'editorial_material_not_ready',
    );
    requireCheck(
      review.sourceOptions.every((url) => new URL(url).hostname === 'example.invalid'),
      'unexpected_fixture_source',
    );
    const publishId = randomUUID();
    await checkpoint('publish_local_fixture_once', { publishRequestId: publishId });
    const published = await post('/api/admin/editorial-signals', {
      requestId: publishId,
      runId,
      candidateIndex: 0,
      expectedRevision: review.revision,
      materialHash: review.materialHash,
      action: 'publish',
      content: { ...review.content, sourceUrls: review.sourceOptions },
      consent: true,
    });
    requireCheck(
      published?.requestId === publishId &&
        published.action === 'publish' &&
        published.revision === 1 &&
        /^editorial-[a-f0-9]{32}$/.test(published.publicId ?? ''),
      'publication_receipt_not_confirmed',
    );
    const publicId = published.publicId;
    await checkpoint('publication_saved', { publicId });
    const detail = await api.request(`/signals/${publicId}`);
    requireCheck(detail.text.includes(fixture.title), 'public_detail_missing');
    for (const path of ['/signals', `/search?q=${suffix}`]) {
      const page = await api.request(path);
      requireCheck(
        page.text.includes(fixture.title) && page.text.includes(`/signals/${publicId}`),
        'public_listing_missing',
      );
    }
    await api.request('/');
    await checkpoint('public_detail_list_search_and_radar_http_verified');

    const current = await api.json(editorialPath);
    requireCheck(
      current.requestId === publishId &&
        current.action === 'publish' &&
        current.publicId === publicId,
      'publication_reread_mismatch',
    );
    const withdrawId = randomUUID();
    await checkpoint('withdraw_local_fixture_once', { withdrawRequestId: withdrawId });
    const withdrawn = await post('/api/admin/editorial-signals', {
      requestId: withdrawId,
      runId,
      candidateIndex: 0,
      expectedRevision: current.revision,
      materialHash: current.materialHash,
      action: 'withdraw',
      content: current.content,
      consent: true,
    });
    requireCheck(
      withdrawn?.requestId === withdrawId &&
        withdrawn.action === 'withdraw' &&
        withdrawn.revision === 2 &&
        withdrawn.publicId === null,
      'withdrawal_receipt_not_confirmed',
    );
    await api.request(`/signals/${publicId}`, { expectStatus: 404 });
    for (const path of ['/signals', `/search?q=${suffix}`]) {
      const page = await api.request(path);
      requireCheck(
        !page.text.includes(`/signals/${publicId}`) && !page.text.includes(fixture.title),
        'withdrawal_still_public',
      );
    }
    const final = await api.json(editorialPath);
    requireCheck(final.action === 'withdraw' && final.revision === 2, 'withdrawal_reread_mismatch');
    await checkpoint('complete', { status: 'passed', finishedAt: new Date().toISOString() });
    log(`[local-smoke] PASS；仅本地虚构记录，已撤回；保留任务历史。脱敏记录：${receiptPath}`);
    return state;
  } catch (error) {
    const code = error instanceof LocalSmokeError ? error.code : 'local_smoke_failed';
    const failedStage = state.stage;
    await checkpoint('stopped_no_automatic_retry', { status: 'failed', failedStage, error: code });
    log(`[local-smoke] STOP ${code}；不自动重复生成、发布或撤回。请核对脱敏记录：${receiptPath}`);
    throw new LocalSmokeError(code);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runLocalDevelopmentSmoke().catch((error) => {
    console.error(
      `[local-smoke] ${error instanceof LocalSmokeError ? error.code : 'failed_without_secret_output'}`,
    );
    process.exitCode = 1;
  });
}
