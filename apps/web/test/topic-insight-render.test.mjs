import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { build } from 'esbuild';

const reportId = '11111111-1111-4111-8111-111111111111';
const reportHref = `/topics/topic-ai/editions/${reportId}`;

function publishedInsight() {
  return {
    id: reportId,
    published_at: '2026-09-27T10:00:00.000Z',
    result: {
      kind: 'topic_insight',
      topicIds: ['topic-ai'],
      windowStart: '2026-08-28T00:00:00.000Z',
      windowEnd: '2026-09-27T00:00:00.000Z',
      generatedAt: '2026-09-26T12:00:00.000Z',
      inputs: [{ id: 'signal-one' }, { id: 'signal-two' }],
      report: {
        title: '合成专题报告：智能体安全',
        summary: '合成摘要：两条公开信号指向同一问题。',
        sections: [
          {
            heading: '证据与判断',
            body: '这只是测试正文，不代表真实发布。',
            signalIds: ['signal-one', 'signal-two'],
          },
        ],
        uncertainties: ['样本量有限。'],
      },
    },
  };
}

const state = {
  topics: [
    {
      frontMatter: { id: 'topic-ai', title: '人工智能' },
      summary: '持续跟踪人工智能。',
    },
  ],
  signals: [
    {
      id: 'signal-one',
      title: '公开证据 A',
      occurred_at: '2026-09-21T12:00:00.000Z',
      topics: ['topic-ai'],
    },
    {
      id: 'signal-two',
      title: '<script>公开证据 B</script>',
      occurred_at: '2026-09-22T12:00:00.000Z',
      topics: ['topic-ai'],
    },
  ],
  rows: [publishedInsight()],
};

async function loadPages() {
  const compiled = await build({
    stdin: {
      contents: `
        export { default as TopicsPage } from './app/topics/page';
        export { default as InsightEdition } from './app/topics/[id]/editions/[edition]/page';
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'tsx',
    },
    bundle: true,
    jsx: 'automatic',
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    external: ['react', 'react/jsx-runtime'],
    loader: { '.module.css': 'empty' },
    plugins: [
      {
        name: 'synthetic-public-insights',
        setup(builder) {
          const fixtures = {
            'next/link': `
              import React from 'react';
              export default function Link({ prefetch, ...props }) {
                return React.createElement('a', props);
              }
            `,
            'next/navigation': `export function notFound() { throw new Error('not_found'); }`,
            '@/components/site-shell': `
              import React from 'react';
              export function SiteShell({ children }) { return React.createElement(React.Fragment, null, children); }
            `,
            '@/lib/content-runtime': `
              export const formatZhDate = (date) => date;
              export async function getTopicEntries() { return globalThis.__topicRenderTest.topics; }
              export async function getInsightEntries() { return []; }
            `,
            '@/lib/seed-runtime': `
              export async function getSignalEntries() { return globalThis.__topicRenderTest.signals; }
            `,
            '@/lib/server/topic-insights': `
              export async function visibleTopicInsights() { return globalThis.__topicRenderTest.rows; }
              export async function visibleTopicInsightById(id) {
                return globalThis.__topicRenderTest.rows.find(row => row.id === id) ?? null;
              }
            `,
          };
          builder.onResolve({ filter: /.*/ }, (args) =>
            fixtures[args.path] === undefined
              ? undefined
              : { path: args.path, namespace: 'synthetic-insights' },
          );
          builder.onLoad({ filter: /.*/, namespace: 'synthetic-insights' }, (args) => ({
            contents: fixtures[args.path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
    createRequire(import.meta.url),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

test('published report card and standalone report render one unified catalog with real evidence links', async () => {
  globalThis.__topicRenderTest = state;
  try {
    const { TopicsPage, InsightEdition } = await loadPages();
    const indexHtml = renderToStaticMarkup(await TopicsPage());
    assert.match(indexHtml, new RegExp(`href="${reportHref}"`));
    assert.match(indexHtml, /合成专题报告：智能体安全/);
    assert.match(indexHtml, /合成摘要：两条公开信号指向同一问题/);
    assert.match(indexHtml, /2 条[^<]*证据/);
    assert.doesNotMatch(indexHtml, /当前|历史/);

    const detailHtml = renderToStaticMarkup(
      await InsightEdition({ params: Promise.resolve({ id: 'topic-ai', edition: reportId }) }),
    );
    assert.match(detailHtml, /<h1>合成专题报告：智能体安全<\/h1>/);
    assert.match(detailHtml, /合成摘要：两条公开信号指向同一问题/);
    assert.match(detailHtml, /<figure/);
    assert.match(detailHtml, /证据日期分布/);
    assert.match(detailHtml, /不是技术热度评分/);
    assert.match(detailHtml, /href="\/signals\/signal-one"/);
    assert.match(detailHtml, /href="\/signals\/signal-two"/);
    assert.match(detailHtml, /&lt;script&gt;公开证据 B&lt;\/script&gt;/);
    assert.doesNotMatch(detailHtml, /<script>公开证据 B<\/script>/);
    assert.doesNotMatch(detailHtml, /当前|历史/);
    await assert.rejects(
      InsightEdition({ params: Promise.resolve({ id: 'topic-other', edition: reportId }) }),
      /not_found/,
    );
  } finally {
    delete globalThis.__topicRenderTest;
  }
});
