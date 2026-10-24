import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscoveryResponse, discoveryRules } from '../lib/source-discovery-core.ts';
import { discoveryJsonSchema } from '../lib/source-discovery-output.ts';
import { isExplicitNonArticleUrl } from '../lib/source-discovery-url-kind.ts';
import { discoveryValidationItems } from '../lib/source-discovery-diagnostics.ts';

const config = { discovery: { keywords: [], lookbackDays: 2, maxSources: 5 } };
const window = { windowStart: '2026-10-22T00:00:00Z', windowEnd: '2026-10-24T00:00:00Z' };
const article = (url) => ({ url, title: 'Research announcement', publishedAt: '2026-10-23' });
const envelope = (articles, urls = articles.map((entry) => entry.url)) => ({
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({ articles }),
        annotations: urls.map((url) => ({ type: 'url_citation', url_citation: { url } })),
      },
    },
  ],
  usage: { server_tool_use: { web_search_requests: 1 } },
});

test('cited tag/category/archive/search/feed listings are rejected instead of treating their cards as full articles', () => {
  for (const url of [
    'https://www.deeplearning.ai/the-batch/tag/oct-23-2026',
    'https://example.com/blog/TaGs/robotics/',
    'https://example.com/blog/%74%61%67/robotics?utm_source=test',
    'https://example.com/blog/%43aTeGoRy/robotics',
    'https://example.com/categories/robotics',
    'https://example.com/blog/tags/robotics/page/2',
    'https://example.com/blog/%74%61%67/robotics/PAGE/3',
    'https://example.com/Archive/',
    'https://example.com/archives/2026/10/23',
    'https://example.com/search?q=robotics',
    'https://example.com/blog/FeEd',
    'https://example.com/rss.xml',
    'https://example.com/atom',
  ]) {
    assert.equal(isExplicitNonArticleUrl(url), true, url);
    const result = parseDiscoveryResponse(envelope([article(url)]), config, window, []);
    assert.deepEqual(result.articles, [], url);
    assert.equal(result.rejected, 1, url);
    assert.deepEqual(result.validation.rejections, [{ index: 0, reasons: ['non_article_url'] }]);
    assert.deepEqual(result.validation.reasonCounts, { non_article_url: 1 });
  }
});

test('direct news, dated articles, papers and official project/repository pages keep ordinary citation checks', () => {
  for (const url of [
    'https://example.com/news/turbovla-research',
    'https://example.com/2026/10/23/turbovla',
    'https://arxiv.org/abs/2610.12345',
    'https://arxiv.org/html/2610.12345v1',
    'https://github.com/lab/turbovla',
    'https://github.com/tag/category',
    'https://gitlab.com/lab/archive',
    'https://turbovla.github.io/',
    'https://example.com/projects/turbovla',
    'https://example.com/archive/turbovla-paper',
    'https://example.com/news/tag-aware-model',
  ]) {
    assert.equal(isExplicitNonArticleUrl(url), false, url);
    const result = parseDiscoveryResponse(envelope([article(url)]), config, window, []);
    assert.deepEqual(result.articles, [article(url)], url);
    assert.equal(result.rejected, 0, url);
    const uncited = parseDiscoveryResponse(envelope([article(url)], []), config, window, []);
    assert.deepEqual(uncited.articles, [], url);
    assert.deepEqual(uncited.validation.rejections, [{ index: 0, reasons: ['uncited_url'] }]);
  }
});

test('a valid primary keeps valid alternatives while a cited listing alternative is rejected', () => {
  const primary = article('https://example.com/news/turbovla');
  const listing = article('https://report.example.com/tag/robotics');
  const alternate = article('https://lab.example.com/projects/turbovla');
  const result = parseDiscoveryResponse(
    envelope(
      [{ ...primary, alternatives: [listing, alternate] }],
      [primary.url, listing.url, alternate.url],
    ),
    config,
    window,
    [],
  );
  assert.deepEqual(result.articles, [{ ...primary, alternatives: [alternate] }]);
  assert.deepEqual(result.alternativeValidation, {
    version: 1,
    returnedCount: 2,
    acceptedCount: 1,
    rejections: [{ index: 0, alternativeIndex: 0, reasons: ['non_article_url'] }],
  });
});

test('TAG organization paths and deep documents are not rejected merely for a taxonomy word', () => {
  for (const url of [
    'https://www.w3.org/2001/tag/doc/leastPower.html',
    'https://www.w3.org/2001/tag/doc/passwordsInTheClear-52.html',
    'https://example.com/2001/TAG/doc/technical-report',
    'https://example.com/lab/%74%61%67/papers/technical-report.pdf',
    'https://example.com/category/research/papers/technical-report',
    'https://example.com/tag/technical-report.html',
    'https://example.com/category/technical-report.pdf',
  ]) {
    assert.equal(isExplicitNonArticleUrl(url), false, url);
    const result = parseDiscoveryResponse(envelope([article(url)]), config, window, []);
    assert.deepEqual(result.articles, [article(url)], url);
    assert.equal(result.rejected, 0, url);
  }
});

test('listing rejection does not suppress citation rejection or expose source data in diagnostics', () => {
  const result = parseDiscoveryResponse(
    envelope([article('https://example.com/tag/private-source-title')], []),
    config,
    window,
    [],
  );
  assert.deepEqual(result.validation.rejections, [
    { index: 0, reasons: ['uncited_url', 'non_article_url'] },
  ]);
  const presentation = discoveryValidationItems(result.validation);
  assert.deepEqual(presentation.summary, [
    '返回条目：1 条 · 有效引用网址：0 个',
    '来源网址与供应商引用不匹配：1 条',
    '来源是列表或订阅页，需要单篇原文地址：1 条',
  ]);
  assert.deepEqual(presentation.rejections, [
    '第 1 条：来源网址与供应商引用不匹配；来源是列表或订阅页，需要单篇原文地址',
  ]);
  assert.equal(JSON.stringify(presentation).includes('private-source-title'), false);
});

test('discovery instructions request cited full articles within the original search budget', () => {
  assert.match(discoveryRules, /单篇新闻、论文、官方公告或项目的正文地址/);
  assert.match(discoveryRules, /同一次发现调用的既定搜索预算内/);
  assert.match(discoveryRules, /未获得具体文章的搜索引用时省略该来源/);
  const properties = discoveryJsonSchema.properties.articles.items.properties;
  assert.match(properties.url.description, /tag\/category\/archive\/search\/feed listings/);
  assert.match(properties.url.description, /do not invent an uncited detail URL/);
  assert.match(
    properties.alternatives.items.properties.url.description,
    /do not invent an uncited detail URL/,
  );
  assert.match(
    properties.alternatives.description,
    /No tag\/category\/archive\/search\/feed listings/,
  );
});
