import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import {
  assertDailyPublicationReady,
  buildDailyDraftRequest,
  dailyInputFingerprint,
  renderDailyDraft,
  selectDailyCandidates,
  validateDailyIntegrity,
} from '../src/daily.js';
import type { ContentEntry } from '../src/loader.js';
import { validateFrontMatter } from '../src/schema.js';
import type { SeedCatalog, SeedSignal } from '../src/seed.js';

function signal(overrides: Partial<SeedSignal> = {}): SeedSignal {
  return {
    captured_at: '2026-08-20T00:00:00Z',
    confidence: 0.9,
    entities: [],
    id: 'signal-example',
    importance: 4,
    novelty: 0.8,
    occurred_at: '2026-08-19T00:00:00Z',
    source_id: 'source-example',
    source_url: 'https://example.com/signal',
    status: 'accepted',
    strength: 4,
    summary: 'A source-backed technology signal.',
    title: 'Example signal',
    topics: ['topic-foundation-models'],
    type: 'technology',
    ...overrides,
  };
}

function catalog(signals: SeedSignal[]): SeedCatalog {
  return {
    entities: [],
    radar: [],
    relations: [],
    signals,
    sources: [
      {
        active: true,
        allowed_hosts: ['example.com'],
        id: 'source-example',
        name: 'Example',
        trust_score: 90,
        type: 'website',
      },
    ],
    topics: [
      { id: 'topic-foundation-models', status: 'strategic', title: 'Foundation Models' },
      { id: 'topic-infrastructure', status: 'active', title: 'Infrastructure' },
      { id: 'topic-archived', status: 'archived', title: 'Archived' },
    ],
  };
}

function dailyEntry(
  overrides: Record<string, unknown> = {},
  body = '## 执行摘要\nSummary.\n\n## Foundation Models｜Example signal\nEvidence-backed analysis.',
): ContentEntry {
  const request = buildDailyDraftRequest('2026-08-20');
  const inputSignal = signal();
  const inputTopic = catalog([inputSignal]).topics[0];
  if (!inputTopic) throw new Error('Expected a Topic fixture');
  const inputFingerprint = dailyInputFingerprint({
    diagnostics: { duplicateSignalIds: [], eligibleSignals: 1 },
    primaryTopicBySignal: new Map([[inputSignal.id, inputTopic]]),
    request,
    signals: [inputSignal],
  });
  const frontMatter = validateFrontMatter({
    cutoff_at: request.cutoffAt,
    date: '2026-08-20',
    edition: 'live',
    generator_version: 'daily-v1',
    id: 'daily-2026-08-20',
    input_fingerprint: inputFingerprint,
    language: 'zh-CN',
    major_developments: 1,
    rising_topics: ['topic-foundation-models'],
    signal_count: 1,
    signal_refs: ['signal-example'],
    status: 'draft',
    summary: 'Summary.',
    timezone: request.timezone,
    title: 'Daily',
    type: 'daily',
    window_start_at: request.windowStartAt,
    ...overrides,
  });
  return {
    body,
    filePath: '/tmp/daily.md',
    frontMatter,
    relativePath: 'daily/2026/2026-08-20.md',
    sections: [
      { heading: '执行摘要', level: 2, paragraphs: ['Summary.'] },
      {
        heading: 'Foundation Models｜Example signal',
        level: 2,
        paragraphs: ['Evidence-backed analysis.'],
      },
    ],
    slug: 'daily/2026/2026-08-20',
    summary: 'Summary.',
  };
}

describe('Daily generation policy', () => {
  it('builds DST-aware, reproducible Europe/Berlin windows', () => {
    expect(buildDailyDraftRequest('2026-03-29')).toMatchObject({
      cutoffAt: '2026-03-29T07:00:00+02:00',
      windowStartAt: '2026-03-28T07:00:00+01:00',
    });
    expect(buildDailyDraftRequest('2026-10-25')).toMatchObject({
      cutoffAt: '2026-10-25T07:00:00+01:00',
      windowStartAt: '2026-10-24T07:00:00+02:00',
    });
    expect(() => buildDailyDraftRequest('2026-02-30')).toThrow('Invalid Daily date');
  });

  it('selects eligible candidates deterministically with topic diversity and URL deduplication', () => {
    const request = buildDailyDraftRequest('2026-08-20');
    const signals = [
      signal(),
      signal({
        id: 'signal-infrastructure',
        importance: 5,
        source_url: 'https://example.com/infrastructure',
        topics: ['topic-infrastructure'],
      }),
      signal({
        id: 'signal-duplicate',
        importance: 3,
        source_url: 'https://example.com/signal?utm_source=test',
      }),
      signal({ id: 'signal-inbox', source_url: 'https://example.com/inbox', status: 'inbox' }),
      signal({
        captured_at: '2026-08-20T06:00:00Z',
        id: 'signal-after-cutoff',
        source_url: 'https://example.com/future',
      }),
    ];

    const first = selectDailyCandidates(catalog(signals), request);
    const second = selectDailyCandidates(catalog([...signals].reverse()), request);
    expect(first.signals.map((entry) => entry.id)).toEqual([
      'signal-infrastructure',
      'signal-example',
    ]);
    expect(second.signals.map((entry) => entry.id)).toEqual(first.signals.map((entry) => entry.id));
    expect(first.diagnostics.duplicateSignalIds).toEqual(['signal-duplicate']);
    expect(
      selectDailyCandidates(catalog(signals), request, new Set(['signal-example'])).signals.map(
        (entry) => entry.id,
      ),
    ).toEqual(['signal-infrastructure', 'signal-duplicate']);
  });

  it('orders offset timestamps by their actual instant', () => {
    const request = { ...buildDailyDraftRequest('2026-08-20'), maxSignals: 1 };
    const byOccurrence = selectDailyCandidates(
      catalog([
        signal({
          id: 'signal-earlier-occurrence',
          occurred_at: '2026-08-19T06:00:00+02:00',
          source_url: 'https://example.com/earlier-occurrence',
        }),
        signal({
          id: 'signal-later-occurrence',
          occurred_at: '2026-08-19T05:00:00Z',
          source_url: 'https://example.com/later-occurrence',
        }),
      ]),
      request,
    );
    expect(byOccurrence.signals.map((entry) => entry.id)).toEqual(['signal-later-occurrence']);

    const byCapture = selectDailyCandidates(
      catalog([
        signal({
          captured_at: '2026-08-20T06:00:00+02:00',
          id: 'signal-earlier-capture',
          source_url: 'https://example.com/earlier-capture',
        }),
        signal({
          captured_at: '2026-08-20T04:30:00Z',
          id: 'signal-later-capture',
          source_url: 'https://example.com/later-capture',
        }),
      ]),
      request,
    );
    expect(byCapture.signals.map((entry) => entry.id)).toEqual(['signal-later-capture']);
  });

  it('uses an exclusive window start and inclusive cutoff', () => {
    const selection = selectDailyCandidates(
      catalog([
        signal({
          captured_at: '2026-08-19T05:00:00Z',
          id: 'signal-at-start',
          source_url: 'https://example.com/start',
        }),
        signal({
          captured_at: '2026-08-20T05:00:00Z',
          id: 'signal-at-cutoff',
          source_url: 'https://example.com/cutoff',
          status: 'reviewed',
        }),
      ]),
      buildDailyDraftRequest('2026-08-20'),
    );

    expect(selection.signals.map((entry) => entry.id)).toEqual(['signal-at-cutoff']);
  });

  it('returns no candidate instead of rendering an empty Daily', () => {
    const selection = selectDailyCandidates(
      catalog([signal({ status: 'rejected' })]),
      buildDailyDraftRequest('2026-08-20'),
    );
    expect(selection.signals).toEqual([]);
    expect(() => renderDailyDraft(selection)).toThrow('Cannot render an empty Daily candidate');
  });

  it('renders byte-stable draft content with provenance and source links', () => {
    const selection = selectDailyCandidates(
      catalog([signal({ source_url: 'https://example.com/signal?utm_source=test#fragment' })]),
      buildDailyDraftRequest('2026-08-20'),
    );
    const first = renderDailyDraft(selection);
    expect(renderDailyDraft(selection)).toBe(first);
    expect(
      renderDailyDraft(
        selectDailyCandidates(catalog([signal()]), buildDailyDraftRequest('2026-08-20')),
      ),
    ).toBe(first);
    expect(first).toContain('status: draft');
    expect(first).toContain('generator_version: daily-v1');
    expect(first).toMatch(/input_fingerprint: sha256:[a-f0-9]{64}/);
    expect(first).toContain('[原始来源](https://example.com/signal)');
  });

  it('round-trips rendered front matter through YAML parsing and integrity validation', () => {
    const selection = selectDailyCandidates(
      catalog([signal()]),
      buildDailyDraftRequest('2026-08-20'),
    );
    const parsed = matter(renderDailyDraft(selection));
    const frontMatter = validateFrontMatter(parsed.data);
    expect(frontMatter.type).toBe('daily');
    if (frontMatter.type !== 'daily') throw new Error('Expected Daily front matter');
    expect(typeof frontMatter.window_start_at).toBe('string');
    expect(typeof frontMatter.cutoff_at).toBe('string');

    const entry: ContentEntry = {
      body: parsed.content.trim(),
      filePath: '/tmp/2026-08-20.md',
      frontMatter,
      relativePath: 'daily/2026/2026-08-20.md',
      sections: [
        { heading: '执行摘要', level: 2, paragraphs: [frontMatter.summary] },
        {
          heading: 'Foundation Models｜Example signal',
          level: 2,
          paragraphs: ['A source-backed technology signal.'],
        },
      ],
      slug: 'daily/2026/2026-08-20',
      summary: frontMatter.summary,
    };
    expect(() => validateDailyIntegrity([entry], catalog([signal()]))).not.toThrow();
  });
});

describe('Daily integrity and publication gates', () => {
  it('accepts a complete live Daily', () => {
    expect(() => validateDailyIntegrity([dailyEntry()], catalog([signal()]))).not.toThrow();
  });

  it('rejects count drift, duplicate refs and duplicate dates', () => {
    const drifted = dailyEntry({
      signal_count: 2,
      signal_refs: ['signal-example', 'signal-example'],
    });
    const duplicate = dailyEntry();
    duplicate.relativePath = 'daily/2026/duplicate.md';
    expect(() => validateDailyIntegrity([drifted, duplicate], catalog([signal()]))).toThrow(
      /duplicate Daily date 2026-08-20/,
    );
    expect(() => validateDailyIntegrity([drifted], catalog([signal()]))).toThrow(
      /duplicate signal_refs signal-example/,
    );
  });

  it('rejects ineligible, future and out-of-window evidence', () => {
    expect(() =>
      validateDailyIntegrity(
        [dailyEntry()],
        catalog([
          signal({
            captured_at: '2026-08-20T06:00:00Z',
            occurred_at: '2026-08-21T00:00:00Z',
            status: 'inbox',
          }),
        ]),
      ),
    ).toThrow(/ineligible Signal signal-example/);
    expect(() =>
      validateDailyIntegrity(
        [dailyEntry()],
        catalog([
          signal({
            captured_at: '2026-08-20T06:00:00Z',
            occurred_at: '2026-08-21T00:00:00Z',
            status: 'inbox',
          }),
        ]),
      ),
    ).toThrow(/future Signal occurrence signal-example/);
  });

  it('requires humans to remove candidate markers before publication', () => {
    const published = dailyEntry(
      { status: 'published' },
      '## 执行摘要\nSummary.\n\n<!-- HZENSE_DAILY_CANDIDATE -->\n\n## Signal\n待人工研判。',
    );
    expect(() => validateDailyIntegrity([published], catalog([signal()]))).toThrow(
      'published Daily contains an automation review marker',
    );
  });

  it('verifies the fixed daily-v1 window and recomputed input fingerprint', () => {
    expect(() =>
      validateDailyIntegrity(
        [dailyEntry({ window_start_at: '2026-08-18T07:00:00+02:00' })],
        catalog([signal()]),
      ),
    ).toThrow('live generation window must match daily-v1');
    expect(() =>
      validateDailyIntegrity(
        [dailyEntry({ input_fingerprint: `sha256:${'a'.repeat(64)}` })],
        catalog([signal()]),
      ),
    ).toThrow('input_fingerprint does not match Daily inputs');
  });

  it('reruns the complete daily-v1 selection against the current catalog', () => {
    expect(() =>
      validateDailyIntegrity(
        [dailyEntry()],
        catalog([
          signal(),
          signal({
            id: 'signal-new-priority',
            importance: 5,
            source_url: 'https://example.com/new-priority',
          }),
        ]),
      ),
    ).toThrow('signal_refs must match daily-v1 selection in order');
  });

  it('blocks draft and review content while allowing published or archived rollback states', () => {
    expect(() => assertDailyPublicationReady([dailyEntry()])).toThrow('status is draft');
    expect(() => assertDailyPublicationReady([dailyEntry({ status: 'review' })])).toThrow(
      'status is review',
    );
    expect(() => assertDailyPublicationReady([dailyEntry({ status: 'published' })])).not.toThrow();
    expect(() => assertDailyPublicationReady([dailyEntry({ status: 'archived' })])).not.toThrow();
  });
});
