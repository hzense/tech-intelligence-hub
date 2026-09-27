import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import {
  relatedResourceReports,
  resourceHref,
  resourceInitials,
  resourceIntroduction,
  resourceMedia,
  resourceProfile,
  resourceTopics,
  resourceTrendObservation,
} from '../lib/resource-presentation.ts';
import { organizationProfiles } from '../lib/resource-organization-profiles.ts';
import { personProfiles } from '../lib/resource-person-profiles.ts';
import { extraResourceMedia } from '../lib/resource-media-extra.ts';

const topicNames = new Map([
  ['topic-ai', '人工智能'],
  ['topic-chips', '半导体'],
]);
function signal(id, occurredAt, topics = ['topic-ai']) {
  return { id, occurred_at: occurredAt, topics };
}
function entity(overrides = {}) {
  return {
    id: 'company-openai',
    name: 'OpenAI',
    type: 'company',
    recentCount: 1,
    signals: [
      signal('recent', '2026-09-22T10:00:00Z'),
      signal('previous', '2026-08-15T10:00:00Z', ['topic-chips']),
    ],
    relatedPeople: [],
    relatedOrganizations: [],
    ...overrides,
  };
}

test('resource introductions describe the entity itself, independently of Signal counts', () => {
  const row = entity();
  assert.equal(resourceHref(row), '/resources/company-openai');
  assert.equal(resourceHref({ id: 'person-lisa-su', type: 'person' }), '/persons/person-lisa-su');
  const introduction = resourceIntroduction(row);
  assert.match(introduction, /OpenAI/);
  assert.doesNotMatch(introduction, /本站|关联.*信号/);
  assert.equal(resourceIntroduction(entity({ signals: [] })), introduction);
  assert.match(resourceProfile('company-openai')?.sourceUrl ?? '', /^https:\/\//);
  assert.deepEqual(resourceTopics(row, topicNames), [
    { id: 'topic-ai', name: '人工智能', count: 1 },
    { id: 'topic-chips', name: '半导体', count: 1 },
  ]);
  assert.equal(
    resourceIntroduction(entity({ id: 'person-unknown', name: '未知人物', type: 'person' })),
    '未知人物的身份与履历简介尚待来源核实。',
  );
});

test('trend numbers use event dates, exclude future events, and do not invent a growth verdict', () => {
  const row = entity({
    signals: [
      signal('recent', '2026-09-22T10:00:00Z'),
      signal('previous', '2026-08-15T10:00:00Z'),
      signal('old', '2026-01-01T10:00:00Z'),
      signal('future', '2026-10-01T10:00:00Z'),
    ],
  });
  assert.deepEqual(resourceTrendObservation(row, new Date('2026-09-27T00:00:00Z')), {
    recent: 1,
    previous: 1,
    asOf: '2026-09-27T00:00:00.000Z',
  });
});

test('report links require an actual cited Signal, not merely the same topic or name', () => {
  const report = (id, inputId) => ({
    id,
    result: {
      topicIds: ['topic-ai'],
      inputs: [{ id: inputId }],
      report: { title: `报告 ${id}`, summary: '已发布摘要' },
      generatedAt: '2026-09-26T00:00:00Z',
    },
  });
  const files = [
    {
      summary: '历史洞察摘要',
      frontMatter: {
        id: 'file-related',
        title: '相关文件洞察',
        date: '2026-09-20',
        companies: [],
        evidence_signals: ['previous'],
      },
    },
    {
      summary: '不相关',
      frontMatter: {
        id: 'file-unrelated',
        title: '不相关文件',
        date: '2026-09-20',
        companies: [],
        evidence_signals: ['elsewhere'],
      },
    },
  ];
  assert.deepEqual(
    relatedResourceReports(
      entity(),
      [report('related', 'recent'), report('unrelated', 'other')],
      files,
    ).map((row) => row.href),
    ['/topics/topic-ai/editions/related', '/insights/file-related'],
  );
});

test('reviewed media is bound to exact IDs and every unknown image gets a placeholder', () => {
  assert.equal(resourceMedia('company-openai')?.kind, 'logo');
  assert.equal(resourceMedia('person-lisa-su')?.kind, 'portrait');
  assert.equal(resourceMedia('person-not-lisa-su'), undefined);
  assert.equal(resourceInitials('Satya Nadella'), 'SN');
  assert.equal(resourceInitials('黄仁勋'), '黄仁');
});

test('curated profiles and images carry source links and match entity IDs', () => {
  for (const [id, profile] of Object.entries(organizationProfiles)) {
    assert.match(id, /^(company|institution)-/);
    assert.match(profile.sourceUrl, /^https:\/\//);
    assert.ok(profile.introduction.trim().length > 12);
    assert.doesNotMatch(profile.introduction, /本站|关联.*信号/);
  }
  for (const [id, profile] of Object.entries(personProfiles)) {
    assert.match(id, /^person-/);
    assert.match(profile.sourceUrl, /^https:\/\//);
    assert.ok(profile.introduction.trim().length > 12);
    assert.doesNotMatch(profile.introduction, /本站|关联.*信号/);
  }
  for (const [id, media] of Object.entries(extraResourceMedia)) {
    assert.match(id, /^(company|institution|person)-/);
    assert.equal(media.kind, id.startsWith('person-') ? 'portrait' : 'logo');
    assert.match(media.url, /^https:\/\//);
    assert.match(media.sourceUrl, /^https:\/\//);
    assert.ok(media.credit && media.license);
  }
});

test('resource pages do not split records into current and history lists', async () => {
  const directory = await readFile(new URL('../app/resources/page.tsx', import.meta.url), 'utf8');
  const cards = await readFile(
    new URL('../components/resource-cards.tsx', import.meta.url),
    'utf8',
  );
  const detail = await readFile(
    new URL('../components/public-entity-detail.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(directory, /archive=1|历史资源档案|当前组织/);
  assert.doesNotMatch(detail, /当前关联信号|历史信号档案/);
  assert.match(directory, /id="organizations"/);
  assert.match(directory, /id="people"/);
  assert.match(cards, /简介来源/);
  assert.match(detail, /简介来源/);
});
