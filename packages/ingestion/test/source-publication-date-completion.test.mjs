import assert from 'node:assert/strict';
import test from 'node:test';
import { parseImportOutput } from '../src/import-task-contract.mjs';
import {
  assessGeneratedCandidates,
  buildGenerationSource,
  GENERATION_SOURCE_PUBLICATION_CONTRACT,
} from '../src/signal-generation-contract.mjs';
import {
  collectSourcePublicationDates,
  completeSourcePublicationDates,
} from '../src/source-publication-date.mjs';

const sourceFor = (...texts) =>
  buildGenerationSource(
    parseImportOutput({
      fragments: texts.map((text, index) => ({ text, locator: { paragraph: index + 1 } })),
    }),
  );
const ref = (fragment_id, quote) => ({ fragment_id, quote });
const draft = (evidence) => ({
  title: '测试新闻候选',
  summary: '原文中已提供这条新闻的事实。',
  event_date: null,
  event_date_evidence: [],
  date_basis: 'source_published',
  persons: [],
  organizations: [],
  resources: [],
  topic_ids: [],
  signal_type: 'product',
  claims: [{ text: '原文事实', evidence }],
});
const assess = (source, candidates) =>
  assessGeneratedCandidates(
    { candidates, reason: '测试输入' },
    source,
    [],
    GENERATION_SOURCE_PUBLICATION_CONTRACT,
  );
const card = (title, body, date = 'Oct 23, 2026') => `${title}\n\n${body}\n\n3 min read\n\n${date}`;

test('the four dated news cards fill null publication dates from their own claim excerpts', () => {
  const cards = [
    [
      'A Single Decoder Turns Small Models into Action',
      'TurboVLA uses a single decoder to combine language and vision.',
    ],
    [
      'Nvidia Courts A New Partner: Reflection releases Beam',
      'Reflection AI announced its first model, Beam.',
    ],
    [
      'ChatGPT for Teens Gets a Report Card',
      'OpenAI added college-planning and study tools to its under-18 experience.',
    ],
    [
      'Meta Releases Wonder, Opens Spark',
      'Meta released Muse Wonder and opened the weights for Muse Spark.',
    ],
  ];
  const source = sourceFor(...cards.map(([title, body]) => card(title, body)));
  const result = assess(
    source,
    cards.map(([, body], index) => draft([ref(`fragment-${index + 1}`, body)])),
  );
  const before = JSON.parse(JSON.stringify({ source, result }));
  const completed = completeSourcePublicationDates(result, source);
  assert.equal(completed.candidates.length, 4);
  for (const candidate of completed.candidates) {
    assert.equal(candidate.event_date, '2026-10-23');
    assert.equal(candidate.issues.includes('needs_event_time'), false);
    const evidence = candidate.event_date_evidence[0];
    const original = source.fragments.find(({ id }) => id === evidence.fragment_id);
    assert.ok(original.text.includes(evidence.quote));
    assert.equal(evidence.quote, '3 min read\n\nOct 23, 2026');
    assert.equal(evidence.fragment_id, candidate.claims[0].evidence[0].fragment_id);
  }
  assert.deepEqual({ source, result }, before);
  assert.deepEqual(completeSourcePublicationDates(completed, source), completed);
  // The database's existing re-validation must accept exactly the same result.
  const inputs = completed.candidates.map((candidate) =>
    Object.fromEntries(
      Object.entries(candidate).filter(
        ([key]) => !['index', 'classification', 'status', 'issues'].includes(key),
      ),
    ),
  );
  assert.deepEqual(assess(source, inputs), completed);
});

test('several cards in one fragment retain their own date and cross-card claims remain unresolved', () => {
  const bodyA = 'Company Alpha released the first public model.';
  const bodyB = 'Company Beta released a separate public model.';
  const source = sourceFor(
    `${card('Alpha model announcement', bodyA, 'Oct 22, 2026')}\n\n${card('Beta model announcement', bodyB)}`,
  );
  const result = assess(source, [
    draft([ref('fragment-1', bodyA)]),
    draft([ref('fragment-1', bodyB)]),
    draft([ref('fragment-1', bodyA), ref('fragment-1', bodyB)]),
  ]);
  assert.deepEqual(
    completeSourcePublicationDates(result, source).candidates.map(({ event_date }) => event_date),
    ['2026-10-22', '2026-10-23', null],
  );
});

test('unassigned or duplicated claim excerpts cannot inherit another article date', () => {
  const shared = 'The company released a separate public model.';
  const unrelated = 'An undated third company announced an unrelated product.';
  const source = sourceFor(
    `${card('Alpha model announcement', shared, 'Oct 22, 2026')}\n\n${card('Beta model announcement', shared)}\n\n${unrelated}`,
  );
  const result = assess(source, [
    draft([ref('fragment-1', shared)]),
    draft([ref('fragment-1', unrelated)]),
    draft([ref('fragment-1', shared), ref('fragment-1', unrelated)]),
  ]);
  assert.deepEqual(completeSourcePublicationDates(result, source), result);
});

test('explicit full publication labels support exact local evidence, including Chinese and English dates', () => {
  for (const [label, expected] of [
    ['Published: October 23, 2026', '2026-10-23'],
    ['Originally published on 23 October 2026', '2026-10-23'],
    ['发布日期：2026年10月23日', '2026-10-23'],
    ['文章发表于2026-10-23。', '2026-10-23'],
    ['首次发布于2024-02-29', '2024-02-29'],
  ]) {
    const body = '该公司公布了可核对的产品更新说明。';
    const source = sourceFor(`${label}\n\n${body}`);
    const completed = completeSourcePublicationDates(
      assess(source, [draft([ref('fragment-1', body)])]),
      source,
    );
    assert.equal(completed.candidates[0].event_date, expected, label);
    assert.deepEqual(completed.candidates[0].event_date_evidence, [ref('fragment-1', label)]);
  }
});

test('page labels never fill claims in another fragment or conflict with another publication date', () => {
  const body = '该公司公布了可核对的产品更新说明。';
  for (const [source, evidence] of [
    [sourceFor('Published: Oct 23, 2026', body), ref('fragment-2', body)],
    [
      sourceFor(`Published: Oct 22, 2026\n\n${body}\n\nPublished: Oct 23, 2026`),
      ref('fragment-1', body),
    ],
    [sourceFor(`Published: Oct 23, 2026\n\n${body}`), ref('fragment-1', 'Oct 23, 2026')],
  ]) {
    const result = assess(source, [draft([evidence])]);
    assert.deepEqual(completeSourcePublicationDates(result, source), result);
  }
});

test('updated, copyright, event dates, missing years and invalid calendar dates are not publication dates', () => {
  const body = 'A company released an updated model for public evaluation.';
  for (const text of [
    `Updated: Oct 23, 2026\n\n${body}`,
    `Last published update: Oct 23, 2026\n\n${body}`,
    `© 2026 Example Company\n\n${body}`,
    `On Oct 23, 2026 the company held a conference.\n\n${body}`,
    `Oct 23, 2026\n\n${body}`,
    `Published: October 23\n\n${body}`,
    `Published: 2026-02-29\n\n${body}`,
    `Published: Oct 23, 2026; Updated: Oct 24, 2026\n\n${body}`,
    card('A product announcement', body, 'Updated: Oct 23, 2026'),
    card('A product announcement', body, 'Oct 23'),
    card('A product announcement', body, 'Feb 30, 2026'),
  ]) {
    const source = sourceFor(text);
    const result = assess(source, [draft([ref('fragment-1', body)])]);
    assert.deepEqual(collectSourcePublicationDates(source), [], text);
    assert.deepEqual(completeSourcePublicationDates(result, source), result, text);
  }
});

test('hints remain ordinary evidence and preserve CRLF quotes', () => {
  const source = sourceFor(
    card('A model announcement', 'A company released a new model to the public.').replaceAll(
      '\n',
      '\r\n',
    ),
  );
  assert.deepEqual(collectSourcePublicationDates(source), [
    {
      date: '2026-10-23',
      kind: 'news_card',
      evidence: ref('fragment-1', '3 min read\r\n\r\nOct 23, 2026'),
    },
  ]);
});

test('long whitespace cannot create an over-limit quote and one article label cannot date another article', () => {
  const body = 'A company released a new model to the public.';
  const undated = 'An unrelated company announced a separate research result.';
  const tooLongQuote = `A model announcement\n\n${body}\n\n3 min read\n\n${' '.repeat(600)}\n\nOct 23, 2026`;
  const multipleArticles = `Published: Oct 23, 2026\n\n${body}\n\n# Another article\n\n${undated}`;
  const twoBodies = `Published: Oct 23, 2026\n\n${body}\n\n${undated}`;
  for (const [text, quote] of [
    [tooLongQuote, body],
    [multipleArticles, undated],
    [twoBodies, undated],
  ]) {
    const source = sourceFor(text);
    const result = assess(source, [draft([ref('fragment-1', quote)])]);
    assert.deepEqual(collectSourcePublicationDates(source), []);
    assert.deepEqual(completeSourcePublicationDates(result, source), result);
  }
});

test('historical event-date contracts and non-null model dates are not rewritten', () => {
  const body = 'A company released a new model to the public.';
  const source = sourceFor(card('A model announcement', body));
  const result = assess(source, [draft([ref('fragment-1', body)])]);
  const historical = JSON.parse(JSON.stringify(result));
  delete historical.candidates[0].date_basis;
  assert.deepEqual(completeSourcePublicationDates(historical, source), historical);
  const provided = JSON.parse(JSON.stringify(result));
  provided.candidates[0].event_date = '2026-10-22';
  provided.candidates[0].event_date_evidence = [ref('fragment-1', '3 min read')];
  assert.deepEqual(completeSourcePublicationDates(provided, source), provided);
});

test('mixed publication and footer dates or consecutive metadata cannot masquerade as card content', () => {
  const body = 'Company Alpha released its first model to the public.';
  for (const text of [
    `A model launch announcement\n\n${body}\n\nPublished: Oct 20, 2026\n\n3 min read\n\nOct 23, 2026`,
    `Published: Oct 20, 2026\n\n${card('A model launch announcement', body)}`,
    `A model launch announcement\n\n${body}\n\nLast updated: Oct 23, 2026\n\n3 min read\n\nOct 23, 2026`,
    `Published: Oct 20, 2026\n\nPublished: Oct 23, 2026\n\n${body}`,
    `Updated: Oct 24, 2026\n\nPublished: Oct 23, 2026\n\n${body}`,
    `2026-10-20\n\nPublished: Oct 23, 2026\n\n${body}`,
  ]) {
    const source = sourceFor(text);
    const result = assess(source, [draft([ref('fragment-1', body)])]);
    assert.deepEqual(collectSourcePublicationDates(source), [], text);
    assert.deepEqual(completeSourcePublicationDates(result, source), result, text);
  }
});

const articleSource = (body, metadata, extra = []) =>
  buildGenerationSource(
    parseImportOutput({
      fragments: [
        ...body.map((text, index) => ({
          text,
          locator: {
            paragraph: index + 1,
            region: `html article 1; paragraphs ${index + 1}-${index + 1}`,
          },
        })),
        ...metadata.map((text) => ({
          text,
          locator: { region: 'html article 1; publication metadata' },
        })),
        ...extra,
      ],
    }),
  );

test('publication metadata completes only claims inside the same semantic article across fragments', () => {
  const body = [
    'First company releases a new public model.',
    'The new model improves retrieval accuracy.',
  ];
  const source = articleSource(body, [
    'article:published_time: 2026-10-30T18:00:21+00:00',
    'datePublished: 2026-10-30T14:00:21-04:00',
  ]);
  const result = assess(source, [
    draft(body.map((text, index) => ref(`fragment-${index + 1}`, text))),
  ]);
  const before = JSON.stringify({ source, result });
  const completed = completeSourcePublicationDates(result, source);
  assert.equal(completed.candidates[0].event_date, '2026-10-30');
  assert.deepEqual(completed.candidates[0].event_date_evidence, [
    ref('fragment-3', 'article:published_time: 2026-10-30T18:00:21+00:00'),
  ]);
  assert.deepEqual(collectSourcePublicationDates(source), [
    {
      date: '2026-10-30',
      evidence: completed.candidates[0].event_date_evidence[0],
      kind: 'article_metadata',
      fragment_ids: ['fragment-1', 'fragment-2'],
    },
  ]);
  assert.equal(JSON.stringify({ source, result }), before);
});

test('unscoped text, other article bodies and metadata-only claims cannot inherit an article date', () => {
  const body = 'First company releases a new public model.';
  const other = 'Second company announces an unrelated model.';
  const metadata = 'datePublished: 2026-10-30';
  const source = articleSource(
    [body],
    [metadata],
    [
      { text: other, locator: { paragraph: 2 } },
      { text: other, locator: { region: 'html article 2; paragraphs 1-1', paragraph: 1 } },
    ],
  );
  for (const evidence of [
    [ref('fragment-3', other)],
    [ref('fragment-4', other)],
    [ref('fragment-2', metadata)],
    [ref('fragment-1', body), ref('fragment-3', other)],
  ]) {
    const result = assess(source, [draft(evidence)]);
    assert.deepEqual(completeSourcePublicationDates(result, source), result);
  }
});

test('claims spanning separate articles cannot share a date even when both dates are equal', () => {
  const first = 'First company releases a new public model.';
  const second = 'Second company announces an unrelated model.';
  const source = articleSource(
    [first],
    ['datePublished: 2026-10-30'],
    [
      { text: second, locator: { region: 'html article 2; paragraphs 1-1', paragraph: 1 } },
      {
        text: 'datePublished: 2026-10-30',
        locator: { region: 'html article 2; publication metadata' },
      },
    ],
  );
  const result = assess(source, [draft([ref('fragment-1', first), ref('fragment-3', second)])]);
  assert.deepEqual(completeSourcePublicationDates(result, source), result);
});

test('conflicting, malformed, updated-only and document-only metadata never complete a date', () => {
  const body = 'First company releases a new public model.';
  for (const metadata of [
    ['datePublished: 2026-10-30', 'article:published_time: 2026-10-29'],
    ['datePublished: 2026-02-30'],
    ['datePublished: 2026-10-30T25:00:00Z'],
    ['datePublished: 2026-10-30', 'datePublished: yesterday'],
    ['dateModified: 2026-10-30'],
  ]) {
    const source = articleSource([body], metadata);
    const result = assess(source, [draft([ref('fragment-1', body)])]);
    assert.deepEqual(collectSourcePublicationDates(source), []);
    assert.deepEqual(completeSourcePublicationDates(result, source), result);
  }
  const source = sourceFor(body, 'datePublished: 2026-10-30');
  const result = assess(source, [draft([ref('fragment-1', body)])]);
  assert.deepEqual(completeSourcePublicationDates(result, source), result);
  const conflicting = articleSource(
    [`Published: Oct 29, 2026\n\n${body}`],
    ['datePublished: 2026-10-30'],
  );
  assert.deepEqual(collectSourcePublicationDates(conflicting), []);
});

test('HTML publication time stays original source date and never rewrites a model-provided date', () => {
  const body = 'First company releases a new public model.';
  const source = articleSource([body], ['time[datetime]: 2026-10-06']);
  const result = assess(source, [draft([ref('fragment-1', body)])]);
  assert.equal(
    completeSourcePublicationDates(result, source).candidates[0].event_date,
    '2026-10-06',
  );
  const supplied = JSON.parse(JSON.stringify(result));
  supplied.candidates[0].event_date = '2026-10-29';
  assert.deepEqual(completeSourcePublicationDates(supplied, source), supplied);
});
