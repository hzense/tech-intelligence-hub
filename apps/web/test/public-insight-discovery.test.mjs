import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { build } from 'esbuild';

test('sitemap lists only topic insight editions still visible against public Signals', async () => {
  const state = {
    signals: [{ id: 'public-evidence' }],
    entities: [
      { id: 'company-visible', type: 'company', signals: [{ id: 'public-evidence' }] },
      { id: 'institution-visible', type: 'institution', signals: [{ id: 'public-evidence' }] },
      { id: 'person-visible', type: 'person', signals: [{ id: 'public-evidence' }] },
      { id: 'company-unlinked', type: 'company', signals: [] },
      { id: 'product-linked', type: 'product', signals: [{ id: 'public-evidence' }] },
    ],
    validatedSignalIds: [],
    visible: [
      {
        id: 'published-report',
        published_at: '2026-09-26T14:00:00.000Z',
        result: { topicIds: ['topic-ai'] },
      },
    ],
  };
  globalThis.__insightSitemapTest = state;
  try {
    const source = await readFile(new URL('../app/sitemap.ts', import.meta.url), 'utf8');
    assert.match(source, /export const dynamic = 'force-dynamic'/);
    assert.match(source, /resourceHref\(entity\)/);
    const bundled = await build({
      entryPoints: [new URL('../app/sitemap.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'isolate-public-sitemap-readers',
          setup(plugin) {
            const modules = {
              '@/lib/public-exploration-runtime': `
                export async function getPublicExploration() {
                  const state = globalThis.__insightSitemapTest;
                  return { signals: state.signals, entities: state.entities };
                }
              `,
              '@/lib/resource-presentation': `
                export function resourceHref(entity) {
                  return entity.type === 'person' ? '/persons/' + entity.id : '/resources/' + entity.id;
                }
              `,
              '@/lib/content-runtime': `
                export async function getInsightEntries() { return []; }
                export async function getTopicEntries() { return []; }
              `,
              '@/lib/server/topic-insights': `
                export async function visibleTopicInsights(signals) {
                  globalThis.__insightSitemapTest.validatedSignalIds = signals.map(signal => signal.id);
                  return globalThis.__insightSitemapTest.visible;
                }
              `,
              '@/lib/public-signal-reader-core': `
                export function readSignalReadMode() { return 'database'; }
              `,
            };
            plugin.onResolve({ filter: /^@\/lib\// }, (args) => ({
              path: args.path,
              namespace: 'test-provider',
            }));
            plugin.onLoad({ filter: /.*/, namespace: 'test-provider' }, (args) => ({
              contents: modules[args.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    const { default: sitemap } = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    const publishedUrl = 'https://hzense.com/topics/topic-ai/editions/published-report';
    const initialUrls = (await sitemap()).map((item) => item.url);
    assert.ok(initialUrls.includes(publishedUrl));
    assert.ok(initialUrls.includes('https://hzense.com/resources/company-visible'));
    assert.ok(initialUrls.includes('https://hzense.com/resources/institution-visible'));
    assert.ok(initialUrls.includes('https://hzense.com/persons/person-visible'));
    assert.ok(!initialUrls.includes('https://hzense.com/resources/company-unlinked'));
    assert.ok(!initialUrls.includes('https://hzense.com/resources/product-linked'));
    assert.deepEqual(state.validatedSignalIds, ['public-evidence']);
    state.visible = [];
    assert.ok(!(await sitemap()).some((item) => item.url === publishedUrl));
  } finally {
    delete globalThis.__insightSitemapTest;
  }
});
