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
      topicIds: ['topic-ai', 'topic-security', 'topic-unknown'],
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
    {
      frontMatter: { id: 'topic-security', title: '人工智能安全' },
      summary: '持续跟踪人工智能安全。',
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
  editorial: [
    {
      frontMatter: {
        id: 'editorial-insight',
        title: '编辑专题报告',
        date: '2026-09-20',
        topics: ['topic-ai', 'topic-security', 'topic-unknown'],
        evidence_signals: ['signal-one'],
      },
      summary: '编辑报告摘要。',
      sections: [],
    },
  ],
};

async function loadPages() {
  const compiled = await build({
    stdin: {
      contents: `
        export { default as TopicsPage } from './app/topics/page';
        export { default as InsightEdition } from './app/topics/[id]/editions/[edition]/page';
        export { default as TopicDetailPage } from './app/topics/[id]/page';
        export { default as EditorialInsightPage } from './app/insights/[id]/page';
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
              export async function getLeafTopicIds() { return new Set(['topic-security']); }
              export async function getTopicTitleMap() {
                return new Map(globalThis.__topicRenderTest.topics.map(topic => [topic.frontMatter.id, topic.frontMatter.title]));
              }
              export async function getTopicEntryById(id) {
                return globalThis.__topicRenderTest.topics.find(topic => topic.frontMatter.id === id);
              }
              export async function getInsightEntries() { return globalThis.__topicRenderTest.editorial; }
              export async function getInsightsForTopic(id) {
                return globalThis.__topicRenderTest.editorial.filter(entry => entry.frontMatter.topics.includes(id));
              }
              export async function getInsightEntryById(id) {
                return globalThis.__topicRenderTest.editorial.find(entry => entry.frontMatter.id === id);
              }
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
    const { TopicsPage, InsightEdition, TopicDetailPage, EditorialInsightPage } = await loadPages();
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
    const topicHtml = renderToStaticMarkup(
      await TopicDetailPage({ params: Promise.resolve({ id: 'topic-ai' }) }),
    );
    const editorialHtml = renderToStaticMarkup(
      await EditorialInsightPage({ params: Promise.resolve({ id: 'editorial-insight' }) }),
    );
    for (const html of [indexHtml, detailHtml, topicHtml, editorialHtml]) {
      const leaves = html.match(/<div[^>]*aria-label="所属专题：[^"]*"[^>]*>[\s\S]*?<\/div>/g);
      const originalScopes = html.match(
        /<div[^>]*aria-label="原生成范围（待细分）：[^"]*"[^>]*>[\s\S]*?<\/div>/g,
      );
      assert.ok(leaves?.length, 'every report path exposes its saved leaf topics');
      assert.ok(
        originalScopes?.length,
        'broad and unknown historical topics remain visible without relabelling',
      );
      for (const label of leaves) {
        assert.match(label, /人工智能安全/);
        assert.doesNotMatch(label, /topic-unknown|>人工智能</);
      }
      for (const label of originalScopes) {
        assert.match(label, />人工智能</);
        assert.match(label, /topic-unknown/);
        assert.doesNotMatch(label, /人工智能安全|跨领域|未标注专题/);
      }
    }
    for (const html of [detailHtml, editorialHtml]) {
      assert.match(html, /href="\/topics\/topic-ai"/);
      assert.match(html, /href="\/topics\/topic-security"/);
      assert.doesNotMatch(html, /href="\/topics\/topic-unknown"/);
    }
    await assert.rejects(
      InsightEdition({ params: Promise.resolve({ id: 'topic-other', edition: reportId }) }),
      /not_found/,
    );
  } finally {
    delete globalThis.__topicRenderTest;
  }
});

test('tracking topic cards include public signal-only topics and fold cards beyond six', async () => {
  const signalOnlyTopics = Array.from({ length: 6 }, (_, index) => ({
    frontMatter: { id: `topic-signal-only-${index + 1}`, title: `仅有信号的专题 ${index + 1}` },
    summary: '已有公开信号，尚无公开报告。',
  }));
  const directoryState = globalThis.structuredClone(state);
  directoryState.topics.push(...signalOnlyTopics, {
    frontMatter: { id: 'topic-empty', title: '没有公开内容的专题' },
    summary: '没有公开信号或报告。',
  });
  directoryState.signals.push(
    ...signalOnlyTopics.flatMap((topic, index) =>
      Array.from({ length: index + 1 }, (_, signalIndex) => ({
        id: `signal-only-${index + 1}-${signalIndex + 1}`,
        title: `公开信号 ${index + 1}-${signalIndex + 1}`,
        occurred_at: '2026-09-25T12:00:00.000Z',
        topics: [topic.frontMatter.id],
      })),
    ),
  );
  globalThis.__topicRenderTest = directoryState;
  try {
    const { TopicsPage } = await loadPages();
    const html = renderToStaticMarkup(await TopicsPage());
    const heading = html.indexOf('>跟踪专题</h2>');
    assert.ok(heading >= 0, 'the tracking topic heading remains visible');
    assert.ok(heading < html.indexOf('>洞察报告</h2>'), 'tracking cards appear before reports');
    const section = html.slice(
      html.lastIndexOf('<section', heading),
      html.indexOf('</section>', heading) + '</section>'.length,
    );
    const folded = section.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
    assert.ok(folded, 'additional tracking cards use native details');
    assert.doesNotMatch(folded.match(/^<details\b[^>]*>/)?.[0] ?? '', /\sopen(?:=|\s|>)/);
    assert.match(folded, /<summary\b[^>]*>[\s\S]*?<\/summary>/);
    const cards = (markup) => [
      ...markup.matchAll(/<a\b[^>]*href="\/topics\/([^"/?#]+)"[^>]*>[\s\S]*?<\/a>/g),
    ];
    const defaultCards = cards(section.replace(folded, ''));
    const foldedCards = cards(folded);
    assert.equal(defaultCards.length, 6, 'six cards are visible before expansion');
    assert.equal(foldedCards.length, 2, 'remaining eligible cards are inside details');
    const allCards = new Map(
      [...defaultCards, ...foldedCards].map((match) => [match[1], match[0]]),
    );
    assert.equal(allCards.size, 8, 'every eligible topic appears once');
    assert.equal(allCards.has('topic-empty'), false);
    assert.doesNotMatch(section, /没有公开内容的专题/);
    const expectedCounts = [
      ['topic-ai', 2, 2],
      ['topic-security', 0, 2],
      ...signalOnlyTopics.map((topic, index) => [topic.frontMatter.id, index + 1, 0]),
    ];
    for (const [id, signalCount, reportCount] of expectedCounts) {
      const card = allCards.get(id);
      assert.ok(card, `topic ${id} keeps its detail link`);
      const text = card.replace(/<[^>]*>/g, ' ');
      assert.match(text, new RegExp(`${signalCount}\\s*条(?:关联)?信号`));
      assert.match(text, new RegExp(`${reportCount}\\s*份(?:公开)?报告`));
    }
  } finally {
    delete globalThis.__topicRenderTest;
  }
});
