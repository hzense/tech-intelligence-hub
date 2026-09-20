import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const enabled = process.env.HZENSE_SIGNAL_GENERATION_BROWSER_TEST === '1';
const storageKey = 'hzense.signal-generation.pending.v1';
const recoveryKey = 'hzense.signal-generation.rejection.v1';
const batchId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const profileId = '33333333-3333-4333-8333-333333333333';
const pendingItemId = '44444444-4444-4444-8444-444444444444';
const smallItemId = '66666666-6666-4666-8666-666666666666';

// The actual client component uses synthetic loopback API responses only. These
// tests do not send documents to providers or prove production authorization.
test(
  'private generation UI: explicit consent, safe output and persistent request recovery',
  { skip: !enabled },
  async (t) => {
    const compiled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';import {AdminSignalGeneration} from './components/admin-signal-generation';import {GenerationLiveDetail} from './components/generation-live-detail';createRoot(document.getElementById('root')).render(location.search.includes('live-detail') ? <GenerationLiveDetail initialRun={{id:'77777777-7777-4777-8777-777777777777',status:'running',progress_phase:'generating'}}/> : <AdminSignalGeneration configured={!location.search.includes('off')} historyConfigured={!location.search.includes('nohistory')}/>);`,
        resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      outfile: '/fixture/entry.js',
      platform: 'browser',
      format: 'esm',
      jsx: 'automatic',
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
    const assets = new Map(
      compiled.outputFiles.map((file) => [`/${file.path.split('/').at(-1)}`, file.contents]),
    );
    let runs = [];
    let commands = [];
    let droppedAction = null;
    let rejectedError = null;
    let profileRevision = 2;
    let profileWarnings = [];
    let mismatchedCreate = false;
    let dashboardRequests = 0;
    let preflightRequests = [];
    let preflightWait = null;
    let preflightResponse;
    let preflightStatus = 200;
    const passedPreflight = () => ({
      status: 'ok',
      checks: {
        configuration: true,
        connection: true,
        tls: true,
        identity: true,
        readOnly: true,
        permissions: true,
      },
    });
    const server = createServer(async (req, res) => {
      if (assets.has(req.url)) {
        res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(assets.get(req.url));
        return;
      }
      if (req.url === '/api/admin/signal-generation/preflight') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        preflightRequests.push({
          method: req.method,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        });
        if (preflightWait) await preflightWait;
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = preflightStatus;
        res.end(JSON.stringify(preflightResponse));
        return;
      }
      if (req.url.startsWith('/api/admin/signal-generation?id=')) {
        const id = new URL(req.url, 'http://fixture').searchParams.get('id');
        commands.push({ action: 'detail', id });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ run: runs.find((run) => run.id === id) }));
        return;
      }
      if (req.url === '/api/admin/signal-generation') {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          dashboardRequests += 1;
          res.end(
            JSON.stringify({
              runs,
              profiles: [
                {
                  id: profileId,
                  revision: profileRevision,
                  name: 'Synthetic private profile',
                  provider_host: 'synthetic-provider.example',
                  readiness: { ready: true, reasons: [], warnings: profileWarnings },
                },
              ],
              batches: [
                {
                  id: batchId,
                  cancelled: false,
                  status: 'partial_success',
                  items: [
                    {
                      id: itemId,
                      status: 'completed',
                      declaration: { name: 'Synthetic source.md' },
                    },
                    {
                      id: pendingItemId,
                      status: 'queued',
                      declaration: { name: 'Unparsed source.md' },
                    },
                    {
                      id: smallItemId,
                      status: 'completed',
                      declaration: { name: 'Small source.md' },
                    },
                  ],
                },
              ],
            }),
          );
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const command = JSON.parse(Buffer.concat(chunks).toString());
        commands.push(command);
        if (rejectedError) {
          const error = rejectedError;
          rejectedError = null;
          res.statusCode = ['invalid_request', 'input_too_large', 'invalid_source'].includes(error)
            ? 400
            : 409;
          res.end(
            JSON.stringify({
              error,
              ...(error === 'task_deleted' ? { previous_id: pendingItemId } : {}),
              message: 'SYNTHETIC_RAW_PROVIDER_DIAGNOSTIC',
            }),
          );
          return;
        }
        if (command.action === 'create' && command.profileRevision !== profileRevision) {
          res.statusCode = 409;
          res.end('{"error":"revision_conflict"}');
          return;
        }
        let run = runs.find((entry) => entry.id === command.id);
        if (command.action === 'inspect_source') {
          res.end(
            JSON.stringify({
              inspection: {
                batchId: command.batchId,
                itemId: command.itemId,
                fence: 1,
                ready: command.itemId === smallItemId,
                sourceBytes: command.itemId === smallItemId ? 500 : 60000,
                limitBytes: 48000,
                fragmentCount: 4,
                locators: [{ id: 'fragment-1', locator: { paragraph: 1 } }],
              },
            }),
          );
          return;
        }
        if (command.action === 'create') {
          run ??= runs.find(
            (entry) =>
              entry.batch_id === command.batchId &&
              entry.item_id === command.itemId &&
              entry.profile_id === command.profileId &&
              entry.profile_revision === command.profileRevision &&
              (entry.retry_of ?? undefined) === command.retryOf,
          );
          run ??= {
            id: command.id,
            status: 'pending',
            batch_id: command.batchId,
            item_id: command.itemId,
            profile_id: command.profileId,
            profile_revision: command.profileRevision,
            retry_of: command.retryOf ?? null,
            reserved_microusd: 50000,
            charged_microusd: 0,
            created_at: '2026-09-17T12:00:00Z',
          };
          if (!runs.includes(run)) runs.unshift(run);
        }
        if (!run) {
          res.statusCode = 404;
          res.end('{"error":"not_found"}');
          return;
        }
        if (command.action === 'run') {
          run.status = droppedAction === 'run' ? 'failed' : 'completed';
          run.can_delete = droppedAction !== 'run';
          run.result = {
            classification: 'private',
            candidates: [
              {
                title: 'Synthetic candidate <script>globalThis.hacked=true</script>',
                summary: 'Synthetic summary',
                event_date: '2026-09-10',
                event_date_evidence: [{ fragment_id: 1, quote: 'September 10, 2026' }],
                persons: [
                  {
                    name: 'Synthetic Person',
                    role: 'Researcher',
                    organization: 'Synthetic Organization',
                    evidence: [{ fragment_id: 2, quote: 'Synthetic Person said' }],
                  },
                ],
                organizations: ['Synthetic Organization'],
                claims: [
                  {
                    text: 'Synthetic claim',
                    evidence: [
                      { fragment_id: 3, quote: '<img src=x onerror=globalThis.hacked=true>' },
                    ],
                  },
                ],
                status: 'needs_review',
                issues: ['needs_public_evidence'],
              },
            ],
            reason: 'PRIVATE_THINKING_SENTINEL',
          };
        }
        if (command.action === 'delete') {
          runs = runs.filter((entry) => entry.id !== command.id);
          res.end(JSON.stringify({ id: command.id, deleted: true }));
          return;
        }
        if (command.action === 'cancel') run.status = 'cancelled';
        if (droppedAction === command.action) {
          droppedAction = null;
          // Simulate a proxy failure after the server accepted the command.
          // An HTTP error avoids browser-level transport retries obscuring the
          // component's own no-retry behavior.
          res.statusCode = 503;
          res.end('{"error":"synthetic_lost_response"}');
          return;
        }
        res.end(
          JSON.stringify({
            run:
              mismatchedCreate && command.action === 'create'
                ? { ...run, item_id: pendingItemId }
                : run,
          }),
        );
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/entry.css"><div id="root"></div><script type="module" src="/entry.js"></script></html>',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch();
    t.after(() => browser.close());

    async function newPage() {
      runs = [];
      commands = [];
      droppedAction = null;
      rejectedError = null;
      profileRevision = 2;
      profileWarnings = [];
      mismatchedCreate = false;
      dashboardRequests = 0;
      preflightRequests = [];
      preflightWait = null;
      preflightResponse = passedPreflight();
      preflightStatus = 200;
      const page = await browser.newPage();
      await page.route('**/*', (route) =>
        route.request().url().startsWith(origin) ? route.continue() : route.abort(),
      );
      return page;
    }
    async function selectInput(page) {
      await page.getByLabel('导入批次').selectOption(batchId);
      await page.getByLabel('已完成解析的资料').selectOption(itemId);
      await page.getByLabel('分阶段模型配置').selectOption(profileId);
    }

    await t.test(
      'old capability warnings do not block creating a task or call AI automatically',
      async () => {
        const page = await newPage();
        profileWarnings = ['extract:structured_output_test_old'];
        await page.goto(origin);
        await selectInput(page);
        await page.getByLabel('已完成解析的资料').selectOption(smallItemId);
        await expect(
          page.getByRole('status').filter({ hasText: '部分能力测试已超过 24 小时' }),
        ).toBeVisible();
        await page.getByRole('button', { name: '检查生成资料（不调用 AI）', exact: true }).click();
        await expect(
          page.getByText(
            '资料检查完成，未创建任务、预留预算或调用 AI。检查通过不代表事实已核验。',
            { exact: true },
          ),
        ).toBeVisible();
        await page.getByRole('checkbox').check();
        await expect(
          page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }),
        ).toBeEnabled();
        assert.equal(commands.filter((c) => ['create', 'execute'].includes(c.action)).length, 0);
        await page.close();
      },
    );

    await t.test(
      'queued and running phases refresh read-only, terminal results stop polling',
      async () => {
        const page = await newPage();
        runs = [
          {
            id: '77777777-7777-4777-8777-777777777777',
            status: 'pending',
            progress_phase: 'queued',
            batch_id: batchId,
            item_id: itemId,
            profile_id: profileId,
            profile_revision: 2,
            reserved_microusd: 0,
            charged_microusd: 0,
            created_at: new Date().toISOString(),
          },
        ];
        await page.clock.install();
        await page.goto(origin);
        await expect(page.getByText('排队中', { exact: true })).toBeVisible();
        await expect(page.getByRole('progressbar', { name: '已完成的任务阶段' })).toHaveAttribute(
          'value',
          '0',
        );
        runs[0] = {
          ...runs[0],
          status: 'running',
          progress_phase: 'generating',
          started_at: new Date().toISOString(),
        };
        await page.clock.fastForward(5100);
        await expect(page.getByText('模型生成中', { exact: true })).toBeVisible();
        await expect(page.getByRole('progressbar', { name: '已完成的任务阶段' })).toHaveAttribute(
          'value',
          '2',
        );
        await expect(page.getByRole('progressbar', { name: '模型生成中' })).not.toHaveAttribute(
          'value',
        );
        assert.ok(commands.every((command) => command.action === 'detail'));
        runs[0] = {
          ...runs[0],
          status: 'completed',
          progress_phase: 'saving',
          finished_at: new Date().toISOString(),
        };
        await page.clock.fastForward(5100);
        await expect(
          page.getByRole('table').getByText('生成完成（私有候选）', { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('progressbar', { name: '已完成的任务阶段' })).toHaveCount(0);
        const count = commands.length;
        await page.clock.fastForward(15000);
        assert.equal(commands.length, count);
        await page.close();
      },
    );
    await t.test(
      'fixed-link detail refreshes persisted candidates and stops polling at completion',
      async () => {
        const page = await newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        runs = [
          {
            id: '77777777-7777-4777-8777-777777777777',
            status: 'running',
            progress_phase: 'generating',
          },
        ];
        await page.clock.install();
        await page.goto(`${origin}/?live-detail`);
        await expect(page.getByText('模型生成中', { exact: true })).toBeVisible();
        runs[0] = {
          ...runs[0],
          status: 'completed',
          result: { classification: 'private', candidates: [], reason: 'Synthetic saved result' },
        };
        await page.clock.fastForward(5100);
        await expect(page.getByText('Synthetic saved result', { exact: true })).toHaveCount(0);
        await expect(
          page.getByText('本次没有生成可供审核的候选信号。', { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('progressbar', { name: '已完成的任务阶段' })).toHaveAttribute(
          'value',
          '5',
        );
        assert.equal(
          await page.evaluate(
            () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
          ),
          true,
        );
        const count = commands.length;
        await page.clock.fastForward(15000);
        assert.equal(commands.length, count);
        assert.ok(commands.every((command) => command.action === 'detail'));
        await page.close();
      },
    );
    await t.test(
      'name-first selection and confirmed task deletion clear the pending request without calling AI',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await expect(page.getByLabel('导入批次').locator('option:checked')).not.toHaveText(batchId);
        await page.getByRole('checkbox', { name: /我允许/ }).check();
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(page.getByRole('link', { name: '任务详情', exact: true })).toHaveCount(1);
        page.once('dialog', (dialog) => dialog.dismiss());
        await page.getByText('更多操作', { exact: true }).click();
        await page.getByRole('button', { name: '删除任务', exact: true }).click();
        await expect(page.getByRole('link', { name: '任务详情', exact: true })).toHaveCount(1);
        page.once('dialog', (dialog) => dialog.accept());
        await page.getByRole('button', { name: '删除任务', exact: true }).click();
        await expect(page.getByText('暂无生成任务。')).toBeVisible();
        await expect(page.getByLabel('导入批次')).toBeEnabled();
        assert.equal(
          await page.evaluate((key) => globalThis.sessionStorage.getItem(key), storageKey),
          null,
        );
        assert.equal(commands.filter((entry) => entry.action === 'run').length, 0);
        await page.close();
      },
    );

    await t.test(
      'source inspection is explicit, blocks oversized creation and resets on input change',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        assert.equal(commands.length, 0);
        await page.getByRole('button', { name: '检查生成资料（不调用 AI）' }).click();
        await expect(page.getByRole('heading', { name: '资料超出单次生成上限' })).toBeVisible();
        await page.getByRole('checkbox').last().check();
        await expect(
          page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }),
        ).toBeDisabled();
        assert.deepEqual(
          commands.map((c) => c.action),
          ['inspect_source'],
        );
        await page.getByLabel('已完成解析的资料').selectOption(smallItemId);
        await expect(page.getByRole('heading', { name: '资料超出单次生成上限' })).toHaveCount(0);
        await page.getByRole('button', { name: '检查生成资料（不调用 AI）' }).click();
        await expect(page.getByRole('heading', { name: '资料大小符合生成要求' })).toBeVisible();
        assert.equal(runs.length, 0);
        assert.deepEqual(
          commands.map((c) => c.action),
          ['inspect_source', 'inspect_source'],
        );
        await page.close();
      },
    );

    await t.test(
      'uncertain outcomes are failed tasks and can be deleted after the execution lease ends',
      async () => {
        const page = await newPage();
        runs = [
          {
            id: '55555555-5555-4555-8555-555555555555',
            batch_id: batchId,
            item_id: itemId,
            profile_id: profileId,
            profile_revision: 2,
            status: 'failed',
            can_delete: false,
            error_code: 'generation_timeout',
            reserved_microusd: '203730',
            charged_microusd: '203730',
            result: null,
          },
        ];
        await page.goto(origin);
        await expect(page.getByText('生成达到本次任务的截止时间', { exact: false })).toBeVisible();
        await page.getByText('诊断与使用说明', { exact: true }).click();
        await expect(
          page.getByText('执行后立即提交后台长任务，模型最多等待 25 分钟', { exact: false }),
        ).toBeVisible();
        await expect(page.getByRole('table').getByText('失败', { exact: true })).toBeVisible();
        await expect(
          page.getByRole('button', { name: '执行生成（调用 AI，可能计费）', exact: true }),
        ).toHaveCount(0);
        assert.equal(commands.length, 0);
        await page.getByText('更多操作', { exact: true }).click();
        await expect(page.getByRole('button', { name: '删除任务', exact: true })).toBeDisabled();
        await expect(page.getByText('执行保护期尚未结束', { exact: false })).toBeVisible();
        runs[0].can_delete = true;
        await page.getByRole('button', { name: '手动刷新列表' }).click();
        await expect(page.getByRole('button', { name: '删除任务', exact: true })).toBeEnabled();
        page.once('dialog', (dialog) => dialog.accept());
        await page.getByRole('button', { name: '删除任务', exact: true }).click();
        await expect(page.getByText('任务已删除。', { exact: true })).toBeVisible();
        await expect(page.getByRole('table').getByText('失败', { exact: true })).toHaveCount(0);
        assert.deepEqual(
          commands.map((command) => command.action),
          ['delete'],
        );
        await page.close();
      },
    );

    await t.test(
      'disabled generation still lists and displays saved candidates without mutations',
      async () => {
        const page = await newPage();
        const id = '55555555-5555-4555-8555-555555555555';
        runs = [
          {
            id,
            batch_id: batchId,
            item_id: itemId,
            profile_id: profileId,
            profile_revision: 2,
            status: 'completed',
            reserved_microusd: 10,
            charged_microusd: 10,
            result: {
              candidates: [
                {
                  title: 'Saved historical candidate',
                  summary: 'Saved historical summary',
                  event_date: '2024-04-24',
                  persons: [
                    {
                      name: 'Saved person',
                      role: 'Researcher',
                      organization: 'Saved organization',
                      evidence: [{ fragment_id: 'fragment-1', quote: 'Original person quote' }],
                    },
                  ],
                  claims: [
                    {
                      text: 'Saved claim',
                      evidence: [{ fragment_id: 'fragment-2', quote: 'Original claim quote' }],
                    },
                  ],
                },
              ],
            },
          },
          {
            id: pendingItemId,
            batch_id: batchId,
            item_id: itemId,
            profile_id: profileId,
            profile_revision: 2,
            status: 'pending',
            reserved_microusd: 10,
            charged_microusd: 0,
          },
        ];
        await page.goto(`${origin}/?off`);
        await expect(
          page.getByText('仍可查看历史任务与已保存候选', { exact: false }),
        ).toBeVisible();
        await expect(page.getByRole('link', { name: '任务详情' })).toHaveCount(2);
        await expect.poll(() => dashboardRequests).toBe(1);
        assert.equal(commands.length, 0);
        await expect(
          page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByRole('button', { name: '执行生成（调用 AI，可能计费）', exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByRole('button', { name: '取消未执行任务', exact: true }),
        ).toBeDisabled();
        await page.getByRole('button', { name: '手动刷新列表', exact: true }).click();
        await expect.poll(() => dashboardRequests).toBe(2);
        await page.getByText('更多操作', { exact: true }).first().click();
        await page.getByRole('button', { name: '查看任务与私有候选', exact: true }).first().click();
        await expect(
          page.getByRole('heading', { name: 'Saved historical candidate' }),
        ).toBeVisible();
        await expect(page.getByText('Saved historical summary', { exact: true })).toBeVisible();
        await expect(
          page.getByText('Saved person · Researcher · Saved organization', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('listitem').filter({ hasText: 'Original claim quote' }),
        ).toBeVisible();
        assert.deepEqual(commands, [{ action: 'detail', id }]);
        await page.reload();
        await expect(page.getByRole('link', { name: '任务详情' })).toHaveCount(2);
        assert.deepEqual(commands, [{ action: 'detail', id }]);
        await page.close();
      },
    );

    await t.test(
      'saved mixed and rejected results show bounded field diagnostics without invoking AI',
      async () => {
        for (const mixed of [true, false]) {
          const page = await newPage();
          const id = '55555555-5555-4555-8555-555555555555';
          runs = [
            {
              id,
              batch_id: batchId,
              item_id: itemId,
              profile_id: profileId,
              profile_revision: 2,
              status: mixed ? 'completed' : 'failed',
              error_code: mixed ? null : 'generation_invalid_output',
              result: {
                classification: 'private',
                validation_version: 1,
                reason: '合成验收',
                candidates: mixed
                  ? [
                      {
                        index: 0,
                        title: '保留的合格候选',
                        summary: '<script>unsafe()</script>',
                        persons: [],
                        claims: [],
                      },
                    ]
                  : [],
                rejected: [
                  {
                    index: 1,
                    classification: 'private',
                    status: 'rejected',
                    errors: [
                      { field: 'title', code: 'title_too_long' },
                      { field: 'event_date_evidence', code: 'unknown_date_has_evidence' },
                    ],
                  },
                ],
              },
            },
          ];
          await page.goto(`${origin}/?off`);
          await page.getByText('更多操作', { exact: true }).click();
          await page.getByRole('button', { name: '查看任务与私有候选', exact: true }).click();
          await expect(
            page.getByText(`结构与引用校验通过 ${mixed ? 1 : 0} 条，拒绝 1 条。`, { exact: false }),
          ).toBeVisible();
          await expect(
            page.getByRole('heading', { name: '原始候选 2', exact: true }),
          ).toBeVisible();
          await expect(page.getByText('title：标题超过 80 个字符', { exact: false })).toBeVisible();
          await expect(
            page.getByText('event_date_evidence：日期未知时', { exact: false }),
          ).toBeVisible();
          if (mixed) {
            await expect(page.getByRole('heading', { name: '保留的合格候选' })).toBeVisible();
            await expect(
              page.getByText('<script>unsafe()</script>', { exact: true }),
            ).toBeVisible();
          }
          assert.ok(commands.every((command) => command.action === 'detail'));
          await page.close();
        }
      },
    );

    await t.test(
      'unconfigured history still permits explicit preflight without dashboard or model requests',
      async () => {
        const page = await newPage();
        await page.goto(`${origin}/?off&nohistory`);
        await page.getByText('诊断与使用说明', { exact: true }).click();
        const preflight = page.getByRole('button', { name: '运行只读连接预检', exact: true });
        await expect(preflight).toBeEnabled();
        assert.equal(preflightRequests.length, 0);
        assert.equal(dashboardRequests, 0);
        assert.equal(commands.length, 0);
        let release;
        preflightWait = new Promise((resolve) => {
          release = resolve;
        });
        try {
          await preflight.click();
          await expect.poll(() => preflightRequests.length).toBe(1);
          await expect(preflight).toBeDisabled();
          assert.deepEqual(preflightRequests, [{ method: 'POST', body: {} }]);
          release();
          await expect(page.getByText('只读连接预检通过', { exact: false })).toBeVisible();
          await expect(preflight).toBeEnabled();
          assert.equal(dashboardRequests, 0);
          assert.equal(commands.length, 0);
          await expect(
            page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }),
          ).toBeDisabled();
        } finally {
          release();
          await page.close();
        }
      },
    );

    await t.test(
      'preflight failures and incomplete checks never expose raw diagnostics or claim success',
      async () => {
        const page = await newPage();
        await page.goto(`${origin}/?off&nohistory`);
        await page.getByText('诊断与使用说明', { exact: true }).click();
        const preflight = page.getByRole('button', { name: '运行只读连接预检', exact: true });
        const secret = 'SYNTHETIC_PREFLIGHT_SECRET';
        for (const fixture of [
          {
            status: 503,
            response: {
              status: 'unavailable',
              error: `<script>${secret}</script>`,
              message: `postgresql://user:${secret}@synthetic.invalid/private`,
              checks: { ...passedPreflight().checks, connection: false },
            },
          },
          {
            status: 200,
            response: {
              status: 'ok',
              checks: { configuration: true, connection: true },
              error: secret,
            },
          },
          {
            status: 200,
            response: {
              status: 'ok',
              checks: { ...passedPreflight().checks, permissions: false },
            },
          },
        ]) {
          preflightStatus = fixture.status;
          preflightResponse = fixture.response;
          let release;
          preflightWait = new Promise((resolve) => {
            release = resolve;
          });
          const expectedRequests = preflightRequests.length + 1;
          try {
            await preflight.click();
            await expect.poll(() => preflightRequests.length).toBe(expectedRequests);
            await expect(preflight).toBeDisabled();
            release();
            await expect(preflight).toBeEnabled();
            await expect(page.getByText('只读连接预检通过', { exact: false })).toHaveCount(0);
            await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
            assert.equal(dashboardRequests, 0);
            assert.equal(commands.length, 0);
          } finally {
            release();
          }
        }
        assert.equal(preflightRequests.length, 3);
        await page.close();
      },
    );

    await t.test(
      'no automatic model calls, consent gate, private cards and mobile layout',
      async () => {
        const page = await newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${origin}/?off`);
        await expect(
          page.getByText('AI 信号生成已关闭或尚未完成配置', { exact: false }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }),
        ).toBeDisabled();
        assert.equal(commands.length, 0);
        await page.goto(origin);
        await selectInput(page);
        await expect(page.getByText('资料发送至：synthetic-provider.example')).toBeVisible();
        await expect(
          page.getByLabel('已完成解析的资料').getByRole('option', { name: 'Unparsed source.md' }),
        ).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }),
        ).toBeDisabled();
        assert.equal(commands.length, 0);
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(page.getByRole('table').getByText('待执行', { exact: true })).toBeVisible();
        assert.equal(commands.length, 1);
        assert.equal(commands[0].consent, true);
        assert.equal(commands[0].profileRevision, 2);
        await expect(page.getByRole('link', { name: '任务详情', exact: true })).toHaveAttribute(
          'href',
          `/admin/signal-generation/${commands[0].id}`,
        );
        assert.equal(commands.filter((entry) => entry.action === 'run').length, 0);
        await page.getByRole('checkbox').uncheck();
        await expect(
          page.getByRole('button', { name: '执行生成（调用 AI，可能计费）' }),
        ).toBeDisabled();
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: '执行生成（调用 AI，可能计费）' }).click();
        await expect(
          page.getByRole('table').getByText('生成完成（私有候选）', { exact: true }),
        ).toBeVisible();
        await expect(page.getByText('PRIVATE_THINKING_SENTINEL', { exact: true })).toHaveCount(0);
        const table = page.getByRole('table', { name: /生成任务/ });
        await expect(table).toBeVisible();
        assert.deepEqual(await table.getByRole('columnheader').allTextContents(), [
          '资料 / 任务',
          '状态',
          '模型配置',
          '创建时间',
          '费用',
          '操作',
        ]);
        await expect(page.getByRole('button', { name: '删除任务', exact: true })).toHaveCount(0);
        const callsBeforeFiltering = commands.length;
        await page.getByLabel('搜索已加载任务').fill('not-a-matching-source');
        await expect(table.getByText('没有匹配的已加载任务。')).toBeVisible();
        await page.getByLabel('搜索已加载任务').fill('Synthetic source');
        await expect(table.getByRole('link', { name: '任务详情' })).toHaveCount(1);
        await page.getByLabel('任务状态', { exact: true }).selectOption('failed');
        await expect(table.getByText('没有匹配的已加载任务。')).toBeVisible();
        await page.getByLabel('任务状态', { exact: true }).selectOption('all');
        await page.getByLabel('搜索已加载任务').fill('');
        assert.equal(commands.length, callsBeforeFiltering);
        await table.scrollIntoViewIfNeeded();
        if (process.env.HZENSE_TABLE_SCREENSHOT)
          await page.screenshot({ path: '/tmp/hzense-generation-table-desktop.png' });
        await expect(
          page.getByText('Synthetic Person · Researcher · Synthetic Organization'),
        ).toBeVisible();
        await expect(
          page.getByText('原文片段 3：<img src=x onerror=globalThis.hacked=true>'),
        ).toBeVisible();
        assert.equal(await page.evaluate(() => globalThis.hacked), undefined);
        assert.equal(commands.filter((entry) => entry.action === 'run').length, 1);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByRole('region', { name: '生成任务表格，可横向滚动' })).toBeVisible();
        if (process.env.HZENSE_TABLE_SCREENSHOT)
          await page.screenshot({ path: '/tmp/hzense-generation-table-mobile.png' });
        assert.equal(
          await page.evaluate(
            () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
          ),
          true,
        );
        await page.getByRole('button', { name: '已核对，准备下一次生成' }).click();
        await expect(page.getByRole('checkbox')).not.toBeChecked();
        assert.equal(
          await page.evaluate((key) => globalThis.sessionStorage.getItem(key), storageKey),
          null,
        );
        assert.deepEqual(errors, []);
        await page.close();
      },
    );

    await t.test(
      'lost create/run responses recover original UUID without paid retries',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        droppedAction = 'create';
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(page.getByText('请求未确认完成。', { exact: false })).toBeVisible();
        const originalId = commands[0].id;
        const stored = await page.evaluate(
          (key) => JSON.parse(globalThis.sessionStorage.getItem(key)),
          storageKey,
        );
        assert.equal(stored.id, originalId);
        assert.deepEqual(Object.keys(stored).sort(), [
          'batchId',
          'id',
          'itemId',
          'profileId',
          'profileRevision',
        ]);
        assert.equal(commands.length, 1);
        await page.reload();
        await expect(page.getByRole('table').getByText('待执行', { exact: true })).toBeVisible();
        assert.equal(commands.length, 1);
        await expect(
          page.getByRole('button', { name: '执行生成（调用 AI，可能计费）' }),
        ).toBeDisabled();
        await page.getByRole('button', { name: '按原请求 ID 查询状态' }).click();
        await expect(page.getByText('已查询原任务，不触发 AI 调用。')).toBeVisible();
        assert.deepEqual(commands.at(-1), { action: 'detail', id: originalId });
        await page.getByRole('checkbox').check();
        droppedAction = 'run';
        await page.getByRole('button', { name: '执行生成（调用 AI，可能计费）' }).click();
        await expect(page.getByText('请求未确认完成。', { exact: false })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('table').getByText('失败', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '已核对，准备下一次生成' })).toBeEnabled();
        await page.getByText('更多操作', { exact: true }).click();
        await expect(page.getByRole('button', { name: '删除任务', exact: true })).toBeDisabled();
        await expect(
          page.getByRole('button', { name: '执行生成（调用 AI，可能计费）' }),
        ).toHaveCount(0);
        assert.equal(commands.filter((entry) => entry.action === 'create').length, 1);
        assert.equal(commands.filter((entry) => entry.action === 'run').length, 1);
        assert.equal(commands.find((entry) => entry.action === 'run').id, originalId);
        await page.close();
      },
    );

    await t.test(
      'corrupt session state or failed persistence closes creation without POST',
      async () => {
        const page = await newPage();
        await page.addInitScript(
          (key) => globalThis.sessionStorage.setItem(key, '{invalid'),
          storageKey,
        );
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        await expect(
          page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }),
        ).toBeDisabled();
        assert.equal(commands.length, 0);
        await page.close();
        const blocked = await newPage();
        await blocked.addInitScript(() => {
          globalThis.Storage.prototype.setItem = () => {
            throw new Error('denied');
          };
        });
        await blocked.goto(origin);
        await selectInput(blocked);
        await blocked.getByRole('checkbox').check();
        await blocked
          .getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true })
          .click();
        await expect(blocked.getByText('请求 ID 保存失败，未发送创建或 AI 请求。')).toBeVisible();
        assert.equal(commands.length, 0);
        await blocked.close();
      },
    );

    await t.test(
      'allowlisted errors explain limits and explicit create confirmation retains original identity',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        rejectedError = 'input_too_large';
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(
          page.getByText('解析文本超过首版 48,000 字节上限。', { exact: false }),
        ).toBeVisible();
        await expect(
          page.getByText('SYNTHETIC_RAW_PROVIDER_DIAGNOSTIC', { exact: false }),
        ).toHaveCount(0);
        const originalRequest = commands[0];
        assert.equal(runs.length, 0);
        assert.equal(commands.length, 1);
        const confirm = page.getByRole('button', {
          name: '使用原编号重新确认创建（不调用 AI）',
          exact: true,
        });
        rejectedError = 'profile_not_ready';
        await confirm.click();
        await expect(page.getByText('模型配置尚未就绪。', { exact: false })).toBeVisible();
        assert.deepEqual(commands[1], originalRequest);
        await page.reload();
        await expect(confirm).toBeDisabled();
        await expect(page.getByText('资料发送至：synthetic-provider.example')).toBeVisible();
        assert.equal(commands.length, 2);
        await page.getByRole('checkbox').check();
        rejectedError = 'SYNTHETIC_SECRET_UNKNOWN_CODE';
        await confirm.click();
        await expect(page.getByText('请求未确认完成。', { exact: false })).toBeVisible();
        await expect(page.getByText('SYNTHETIC_SECRET_UNKNOWN_CODE', { exact: false })).toHaveCount(
          0,
        );
        await expect(
          page.getByText('SYNTHETIC_RAW_PROVIDER_DIAGNOSTIC', { exact: false }),
        ).toHaveCount(0);
        await confirm.click();
        await expect(page.getByRole('table').getByText('待执行', { exact: true })).toBeVisible();
        assert.equal(commands.length, 4);
        for (const command of commands) assert.deepEqual(command, originalRequest);
        assert.equal(commands.filter((command) => command.action === 'run').length, 0);
        await page.close();
      },
    );

    await t.test(
      'an existing task must be selected and consent renewed for its recipient',
      async () => {
        const page = await newPage();
        const id = '55555555-5555-4555-8555-555555555555';
        runs = [
          {
            id,
            status: 'pending',
            batch_id: batchId,
            item_id: itemId,
            profile_id: profileId,
            profile_revision: 2,
            reserved_microusd: 50000,
            charged_microusd: 0,
            created_at: '2026-09-17T12:00:00Z',
          },
        ];
        await page.goto(origin);
        await page.getByRole('checkbox').check();
        await expect(
          page.getByRole('button', { name: '执行生成（调用 AI，可能计费）' }),
        ).toBeDisabled();
        await page.getByRole('button', { name: '选择此任务并核对接收方' }).click();
        await expect(page.getByRole('checkbox')).not.toBeChecked();
        await expect(page.getByText('资料发送至：synthetic-provider.example')).toBeVisible();
        assert.equal(commands.length, 0);
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: '执行生成（调用 AI，可能计费）' }).click();
        await expect(
          page.getByRole('table').getByText('生成完成（私有候选）', { exact: true }),
        ).toBeVisible();
        assert.deepEqual(commands, [{ action: 'run', id }]);
        await page.close();
      },
    );

    await t.test(
      'semantic duplicates adopt the canonical task without generating or getting stuck',
      async () => {
        const page = await newPage();
        const canonicalId = '77777777-7777-4777-8777-777777777777';
        runs = [
          {
            id: canonicalId,
            status: 'completed',
            batch_id: batchId,
            item_id: itemId,
            profile_id: profileId,
            profile_revision: 2,
            reserved_microusd: 50000,
            charged_microusd: 1000,
            created_at: '2026-09-17T12:00:00Z',
          },
        ];
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(
          page.getByText('已复用相同资料与配置的原任务', { exact: false }),
        ).toBeVisible();
        assert.notEqual(commands[0].id, canonicalId);
        const stored = await page.evaluate(
          (key) => JSON.parse(globalThis.sessionStorage.getItem(key)),
          storageKey,
        );
        assert.equal(stored.id, canonicalId);
        assert.equal(stored.itemId, itemId);
        await expect(page.getByRole('checkbox')).not.toBeChecked();
        await expect(page.getByRole('button', { name: '已核对，准备下一次生成' })).toBeEnabled();
        assert.equal(commands.length, 1);
        await page.reload();
        await expect(page.getByRole('button', { name: '已核对，准备下一次生成' })).toBeEnabled();
        await page.getByRole('button', { name: '已核对，准备下一次生成' }).click();
        await expect(page.getByLabel('导入批次')).toBeEnabled();
        assert.equal(commands.length, 1);
        assert.equal(runs.length, 1);
        await page.close();
      },
    );

    await t.test(
      'mismatched canonical response is rejected without replacing the saved request',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        mismatchedCreate = true;
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(
          page.getByText('返回任务与所选资料或配置不一致。', { exact: false }),
        ).toBeVisible();
        const stored = await page.evaluate(
          (key) => JSON.parse(globalThis.sessionStorage.getItem(key)),
          storageKey,
        );
        assert.equal(stored.id, commands[0].id);
        assert.equal(stored.itemId, itemId);
        await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toHaveCount(0);
        assert.equal(commands.length, 1);
        await page.close();
      },
    );

    await t.test(
      'a definite source rejection can be abandoned only after a fresh server not_found, then changed to a small input',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        rejectedError = 'input_too_large';
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(
          page.getByText('解析文本超过首版 48,000 字节上限。', { exact: false }),
        ).toBeVisible();
        const originalId = commands[0].id;
        await expect(page.getByLabel('已完成解析的资料')).toBeDisabled();
        const abandon = page.getByRole('button', { name: '核对并放弃未创建请求' });
        rejectedError = 'commit_unknown';
        await abandon.click();
        await expect(page.getByText('服务端尚无法确认任务记录，', { exact: false })).toBeVisible();
        assert.equal(
          (
            await page.evaluate(
              (key) => JSON.parse(globalThis.sessionStorage.getItem(key)),
              storageKey,
            )
          ).id,
          originalId,
        );
        await expect(page.getByLabel('已完成解析的资料')).toBeDisabled();
        await abandon.click();
        await expect(page.getByText('已核对服务器未创建原请求，', { exact: false })).toBeVisible();
        assert.deepEqual(commands.slice(1), [
          { action: 'detail', id: originalId },
          { action: 'detail', id: originalId },
        ]);
        assert.equal(
          await page.evaluate((key) => globalThis.sessionStorage.getItem(key), storageKey),
          null,
        );
        await page.getByLabel('已完成解析的资料').selectOption(smallItemId);
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(page.getByRole('table').getByText('待执行', { exact: true })).toBeVisible();
        assert.notEqual(commands.at(-1).id, originalId);
        assert.equal(commands.at(-1).itemId, smallItemId);
        assert.equal(commands.filter((command) => command.action === 'run').length, 0);
        await page.close();
      },
    );

    await t.test(
      'deleted-task rejection can recover after reload without bypassing deduplication or calling AI',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        rejectedError = 'task_deleted';
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(
          page.getByText('同一资料与配置的任务已删除。', { exact: false }),
        ).toBeVisible();
        const originalId = commands[0].id;
        const abandon = page.getByRole('button', { name: '核对并放弃未创建请求' });
        await expect(abandon).toBeEnabled();
        await expect(page.getByLabel('已完成解析的资料')).toBeDisabled();

        await page.reload();
        await expect(page.getByRole('heading', { name: '当前请求', exact: true })).toBeVisible();
        assert.equal(commands.length, 1);
        await expect(abandon).toBeEnabled();
        await expect(page.getByRole('checkbox')).not.toBeChecked();
        await expect(
          page.getByRole('button', { name: '重新生成（创建新任务，不调用 AI）', exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByText('已恢复原请求及创建拒绝原因：', { exact: false }),
        ).toBeVisible();

        rejectedError = 'commit_unknown';
        await abandon.click();
        await expect(page.getByText('服务端尚无法确认任务记录，', { exact: false })).toBeVisible();
        await expect(page.getByLabel('已完成解析的资料')).toBeDisabled();
        await abandon.click();
        await expect(page.getByRole('heading', { name: '当前请求', exact: true })).toHaveCount(0);
        assert.deepEqual(commands.slice(1), [
          { action: 'detail', id: originalId },
          { action: 'detail', id: originalId },
        ]);
        assert.equal(
          await page.evaluate((key) => globalThis.sessionStorage.getItem(key), storageKey),
          null,
        );
        assert.equal(
          await page.evaluate((key) => globalThis.sessionStorage.getItem(key), recoveryKey),
          null,
        );
        await expect(page.getByRole('checkbox')).not.toBeChecked();
        await page.getByLabel('导入批次').selectOption(batchId);
        await page.getByLabel('已完成解析的资料').selectOption(smallItemId);
        await page.getByLabel('分阶段模型配置').selectOption(profileId);
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(page.getByRole('table').getByText('待执行', { exact: true })).toBeVisible();
        assert.notEqual(commands.at(-1).id, originalId);
        assert.equal(commands.at(-1).itemId, smallItemId);
        assert.equal(commands.filter((command) => command.action === 'run').length, 0);
        await page.close();
      },
    );

    await t.test(
      'restored rejection allows an explicit linked retry but never restores consent or executes AI',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        rejectedError = 'task_deleted';
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toBeEnabled();
        const originalId = commands[0].id;
        await page.reload();
        const retry = page.getByRole('button', {
          name: '重新生成（创建新任务，不调用 AI）',
          exact: true,
        });
        await expect(retry).toBeDisabled();
        assert.equal(commands.length, 1);
        await page.getByRole('checkbox').check();
        page.once('dialog', (dialog) => dialog.accept());
        await retry.click();
        await expect(page.getByRole('table').getByText('待执行', { exact: true })).toBeVisible();
        assert.equal(commands.length, 2);
        assert.equal(commands[1].retryOf, pendingItemId);
        assert.notEqual(commands[1].id, originalId);
        assert.equal(commands[1].action, 'create');
        assert.equal(
          await page.evaluate((key) => globalThis.sessionStorage.getItem(key), recoveryKey),
          null,
        );
        await page.close();
      },
    );

    await t.test(
      'legacy missing-task recovery explains same-ID confirmation without unlocking from a 404',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        rejectedError = 'task_deleted';
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toBeEnabled();
        const originalRequest = commands[0];
        await page.evaluate((key) => globalThis.sessionStorage.removeItem(key), recoveryKey);
        await page.reload();
        await page.getByRole('button', { name: '按原请求 ID 查询状态' }).click();
        await expect(page.getByText('暂未查到原任务。', { exact: false })).toBeVisible();
        await expect(
          page.getByText('当前保留原请求，暂不能更换资料。', { exact: false }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toHaveCount(0);
        await expect(page.getByLabel('导入批次')).toBeDisabled();
        await page.getByRole('checkbox').check();
        rejectedError = 'task_deleted';
        await page.getByRole('button', { name: '使用原编号重新确认创建（不调用 AI）' }).click();
        await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toBeEnabled();
        assert.deepEqual(commands.at(-1), originalRequest);
        assert.equal(commands.filter((entry) => entry.action === 'run').length, 0);
        await page.close();
      },
    );

    await t.test(
      'corrupt, mismatched and unrecognized rejection receipts never unlock recovery',
      async () => {
        for (const variant of [
          'broken-json',
          'wrong-request',
          'unknown-code',
          'extra-field',
          'bad-parent',
        ]) {
          const page = await newPage();
          await page.goto(origin);
          await selectInput(page);
          await page.getByRole('checkbox').check();
          rejectedError = 'task_deleted';
          await page
            .getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true })
            .click();
          await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toBeEnabled();
          await page.evaluate(
            ({ key, variant, otherId }) => {
              const receipt = JSON.parse(globalThis.sessionStorage.getItem(key));
              if (variant === 'wrong-request') receipt.request.itemId = otherId;
              if (variant === 'unknown-code') receipt.code = 'SYNTHETIC_RAW_SECRET';
              if (variant === 'extra-field') receipt.raw = 'SYNTHETIC_RAW_SECRET';
              if (variant === 'bad-parent') receipt.previousId = 'SYNTHETIC_RAW_SECRET';
              globalThis.sessionStorage.setItem(
                key,
                variant === 'broken-json' ? '{' : JSON.stringify(receipt),
              );
            },
            { key: recoveryKey, variant, otherId: smallItemId },
          );
          await page.reload();
          await expect(page.getByRole('heading', { name: '当前请求', exact: true })).toBeVisible();
          await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toHaveCount(0);
          await expect(
            page.getByRole('button', { name: '重新生成（创建新任务，不调用 AI）', exact: true }),
          ).toHaveCount(0);
          await expect(page.getByLabel('导入批次')).toBeDisabled();
          assert.equal(commands.length, 1);
          assert.equal(
            (await page.locator('body').innerText()).includes('SYNTHETIC_RAW_SECRET'),
            false,
          );
          await page.close();
        }
      },
    );

    await t.test(
      'recovery storage failure blocks re-confirmation before sending a new create request',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        rejectedError = 'invalid_source';
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toBeEnabled();
        await page.evaluate((key) => {
          const original = globalThis.Storage.prototype.removeItem;
          globalThis.Storage.prototype.removeItem = function (name) {
            if (name === key) throw new Error('synthetic_storage_failure');
            return original.call(this, name);
          };
        }, recoveryKey);
        await page.getByRole('button', { name: '使用原编号重新确认创建（不调用 AI）' }).click();
        await expect(page.getByText('恢复记录未能安全更新，', { exact: false })).toBeVisible();
        assert.equal(commands.length, 1);
        await expect(
          page.getByRole('button', { name: '使用原编号重新确认创建（不调用 AI）' }),
        ).toBeDisabled();
        await page.close();
      },
    );

    await t.test(
      'explicit retry creates a linked task, survives a lost response and reload, and never auto-runs AI',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        rejectedError = 'task_deleted';
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        const retry = page.getByRole('button', {
          name: '重新生成（创建新任务，不调用 AI）',
          exact: true,
        });
        await expect(retry).toBeEnabled();
        const rejectedId = commands[0].id;
        page.once('dialog', (dialog) => dialog.dismiss());
        await retry.click();
        assert.equal(commands.length, 1);
        await page.getByRole('checkbox').uncheck();
        await expect(retry).toBeDisabled();
        await page.getByRole('checkbox').check();
        page.once('dialog', (dialog) => dialog.accept());
        droppedAction = 'create';
        await retry.click();
        await expect(page.getByText('请求未确认完成。', { exact: false })).toBeVisible();
        const retryId = commands.at(-1).id;
        assert.notEqual(retryId, rejectedId);
        assert.equal(commands.at(-1).retryOf, pendingItemId);
        await page.reload();
        await expect(page.getByRole('table').getByText('待执行', { exact: true })).toBeVisible();
        await page.getByText('更多操作', { exact: true }).click();
        await expect(
          page.getByText(`重新生成自任务：${pendingItemId}；旧费用保留。`),
        ).toBeVisible();
        const stored = await page.evaluate(
          (key) => JSON.parse(globalThis.sessionStorage.getItem(key)),
          storageKey,
        );
        assert.equal(stored.id, retryId);
        assert.equal(stored.retryOf, pendingItemId);
        assert.equal(commands.length, 2);
        await expect(
          page.getByRole('button', { name: '执行生成（调用 AI，可能计费）' }),
        ).toBeDisabled();
        await page.getByRole('button', { name: '按原请求 ID 查询状态' }).click();
        await expect(page.getByText('已查询原任务，不触发 AI 调用。')).toBeVisible();
        assert.deepEqual(commands.at(-1), { action: 'detail', id: retryId });
        assert.equal(commands.filter((command) => command.action === 'run').length, 0);
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: '执行生成（调用 AI，可能计费）' }).click();
        await expect(
          page.getByRole('table').getByText('生成完成（私有候选）', { exact: true }),
        ).toBeVisible();
        assert.deepEqual(commands.at(-1), { action: 'run', id: retryId });
        assert.equal(commands.filter((command) => command.action === 'run').length, 1);
        await page.close();
      },
    );

    await t.test(
      'a stale profile revision can be explicitly abandoned after a fresh not_found and refreshed for a new request',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        profileRevision = 3;
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(page.getByText('模型配置版本已变化，', { exact: false })).toBeVisible();
        const originalRequest = commands[0];
        assert.equal(originalRequest.profileRevision, 2);
        assert.equal(runs.length, 0);
        assert.equal(commands.length, 1);
        await expect(page.getByLabel('分阶段模型配置')).toBeDisabled();
        const abandon = page.getByRole('button', { name: '核对并放弃未创建请求' });
        await expect(abandon).toBeEnabled();
        await page.getByRole('button', { name: '手动刷新列表' }).click();
        await expect(page.getByText('列表已刷新；未调用 AI。')).toBeVisible();
        await expect(
          page.getByLabel('分阶段模型配置').getByRole('option', {
            name: 'Synthetic private profile · r3',
          }),
        ).toHaveCount(1);
        assert.deepEqual(
          await page.evaluate(
            (key) => JSON.parse(globalThis.sessionStorage.getItem(key)),
            storageKey,
          ),
          {
            id: originalRequest.id,
            batchId,
            itemId,
            profileId,
            profileRevision: 2,
          },
        );
        assert.equal(commands.length, 1);
        await abandon.click();
        await expect(page.getByText('已核对服务器未创建原请求，', { exact: false })).toBeVisible();
        assert.deepEqual(commands, [originalRequest, { action: 'detail', id: originalRequest.id }]);
        assert.equal(
          await page.evaluate((key) => globalThis.sessionStorage.getItem(key), storageKey),
          null,
        );
        await expect(page.getByLabel('分阶段模型配置')).toBeEnabled();
        await expect(page.getByRole('checkbox')).not.toBeChecked();
        await selectInput(page);
        const create = page.getByRole('button', {
          name: '创建生成任务（不调用 AI）',
          exact: true,
        });
        await expect(create).toBeDisabled();
        await page.getByRole('checkbox').check();
        await create.click();
        await expect(page.getByRole('table').getByText('待执行', { exact: true })).toBeVisible();
        assert.notEqual(commands.at(-1).id, originalRequest.id);
        assert.equal(commands.at(-1).profileRevision, 3);
        assert.equal(commands.at(-1).itemId, itemId);
        assert.equal(commands.length, 3);
        assert.equal(commands.filter((command) => command.action === 'run').length, 0);
        await page.close();
      },
    );

    await t.test(
      'commit_unknown after a revision rejection revokes abandonment and retains the same request',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        profileRevision = 3;
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        const abandon = page.getByRole('button', { name: '核对并放弃未创建请求' });
        await expect(abandon).toBeEnabled();
        const originalRequest = commands[0];
        const stored = await page.evaluate(
          (key) => globalThis.sessionStorage.getItem(key),
          storageKey,
        );
        rejectedError = 'commit_unknown';
        await page.getByRole('button', { name: '使用原编号重新确认创建（不调用 AI）' }).click();
        await expect(page.getByText('服务端尚无法确认任务记录，', { exact: false })).toBeVisible();
        await expect(abandon).toHaveCount(0);
        await expect(page.getByLabel('分阶段模型配置')).toBeDisabled();
        assert.deepEqual(commands, [originalRequest, originalRequest]);
        await page.getByRole('button', { name: '按原请求 ID 查询状态' }).click();
        await expect(page.getByText('暂未查到原任务。', { exact: false })).toBeVisible();
        await expect(abandon).toHaveCount(0);
        assert.deepEqual(commands.at(-1), { action: 'detail', id: originalRequest.id });
        assert.equal(commands.length, 3);
        assert.equal(
          await page.evaluate((key) => globalThis.sessionStorage.getItem(key), storageKey),
          stored,
        );
        await page.reload();
        await expect(
          page.getByRole('button', { name: '使用原编号重新确认创建（不调用 AI）' }),
        ).toBeDisabled();
        await expect(abandon).toHaveCount(0);
        assert.equal(commands.length, 3);
        assert.equal(commands.filter((command) => command.action === 'run').length, 0);
        await page.close();
      },
    );

    await t.test(
      'unknown create outcomes cannot be abandoned, and an existing task blocks abandonment',
      async () => {
        const page = await newPage();
        await page.goto(origin);
        await selectInput(page);
        await page.getByRole('checkbox').check();
        rejectedError = 'commit_unknown';
        await page.getByRole('button', { name: '创建生成任务（不调用 AI）', exact: true }).click();
        await expect(page.getByText('服务端尚无法确认任务记录，', { exact: false })).toBeVisible();
        await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toHaveCount(0);
        rejectedError = 'invalid_source';
        await page.getByRole('button', { name: '使用原编号重新确认创建（不调用 AI）' }).click();
        await expect(page.getByText('解析结果格式无效。', { exact: false })).toBeVisible();
        const id = commands[0].id;
        await page.reload();
        await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toBeEnabled();
        runs = [
          {
            id,
            status: 'pending',
            batch_id: batchId,
            item_id: itemId,
            profile_id: profileId,
            profile_revision: 2,
            reserved_microusd: 50000,
            charged_microusd: 0,
            created_at: '2026-09-17T12:00:00Z',
          },
        ];
        await page.getByRole('button', { name: '核对并放弃未创建请求' }).click();
        await expect(
          page.getByText('服务器已存在此任务，不能放弃原编号。', { exact: false }),
        ).toBeVisible();
        assert.equal(
          (
            await page.evaluate(
              (key) => JSON.parse(globalThis.sessionStorage.getItem(key)),
              storageKey,
            )
          ).id,
          id,
        );
        await expect(page.getByLabel('已完成解析的资料')).toBeDisabled();
        await expect(page.getByRole('button', { name: '核对并放弃未创建请求' })).toHaveCount(0);
        assert.equal(
          await page.evaluate((key) => globalThis.sessionStorage.getItem(key), recoveryKey),
          null,
        );
        await page.close();
      },
    );
  },
);
