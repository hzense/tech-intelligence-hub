import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRadarAssessment } from '../lib/radar-assessment.ts';
import { buildSignalRadar } from '../lib/signal-radar-model.ts';

const signal = (id, text, date = '2026-10-25T00:00:00.000Z', extra = {}) => ({
  id,
  title: text,
  summary: text,
  occurredAt: date,
  domainIds: ['topic-ai'],
  ...extra,
});
const hotspot = (ids, extra = {}) => ({
  id: 'topic-ai',
  name: '人工智能',
  domainName: '人工智能',
  kind: 'domain',
  recentCount: ids.length,
  previousCount: 2,
  signalIds: ids,
  trend: { state: 'rising', label: '升温', delta: ids.length - 2 },
  series: Array.from({ length: 8 }, (_, index) => ({
    start: `2026-10-${String(19 + index).padStart(2, '0')}T00:00:00.000Z`,
    end: `2026-10-${String(20 + index).padStart(2, '0')}T00:00:00.000Z`,
    count: 0,
  })),
  resources: [],
  ...extra,
});

test('assessment uses only selected identities, preserves published judgment attribution and bounds excerpts', () => {
  const selected = [
    signal('a', '应用部署进展', undefined, { analysis: '原文认为仍需长期验证。' }),
    signal('b', '实验尚未验证', undefined, {
      analysis: '此前分析只是初步判断。',
      analysisTruncated: true,
    }),
    signal('c', '研究报告', undefined, { analysis: '公开研判三。' }),
    signal('d', '研究报告四', undefined, { analysis: '公开研判四。' }),
    signal('outside', '无关项目已实现商业突破', undefined, { analysis: '不应显示' }),
    signal('a', '应用部署进展', undefined, { analysis: '原文认为仍需长期验证。' }),
  ];
  const result = buildRadarAssessment(hotspot(['a', 'b', 'c', 'd']), selected);
  assert.equal(result.judgments.length, 3);
  assert.equal(result.judgments[0].signalId, 'a');
  assert.equal(result.judgments[0].text, '原文认为仍需长期验证。');
  assert.equal(result.judgments[1].truncated, true);
  assert.ok(result.themes.every((theme) => theme.signalIds.every((id) => id !== 'outside')));
  assert.match(result.activity, /当前 4 条/);
  assert.match(result.direction, /涉及/);
  assert.doesNotMatch(result.direction, /已经实现|商业突破|已经成熟/);
});

test('content shifts describe observation, not technical transition, with dated evidence', () => {
  const selected = [
    signal('a', '研究论文与基准评测', '2026-10-20T00:00:00Z'),
    signal('b', '研究实验与能力基准', '2026-10-21T00:00:00Z'),
    signal('c', '产品向客户部署', '2026-10-24T00:00:00Z'),
    signal('d', '应用上线', '2026-10-25T00:00:00Z'),
  ];
  const result = buildRadarAssessment(hotspot(selected.map((s) => s.id)), selected);
  assert.match(result.direction, /前半段较多涉及“研究与能力验证”/);
  assert.match(result.direction, /后半段较多涉及“产品与应用”/);
  assert.match(result.direction, /观察重点有所变化/);
  assert.match(result.limitations.join(''), /观察重点变化不等于技术路线已经转换/);
  assert.equal(result.milestones[0].signalId, 'd');
  assert.deepEqual(result.themes.find((t) => t.id === 'adoption').signalIds, ['d', 'c']);
  assert.deepEqual(result.judgments, []);
  assert.match(result.limitations.join(''), /尚无可展示的已发布研判/);
});

test('tied themes and negated achievements never become a claimed development trajectory', () => {
  const selected = [
    signal('a', '研究未证明产品有效', '2026-10-20T00:00:00Z'),
    signal('b', '论文未证明应用已成熟', '2026-10-21T00:00:00Z'),
    signal('c', '应用仍有安全风险', '2026-10-24T00:00:00Z'),
    signal('d', '产品安全研究不足', '2026-10-25T00:00:00Z'),
  ];
  const result = buildRadarAssessment(hotspot(selected.map((s) => s.id)), selected);
  assert.doesNotMatch(result.direction, /观察重点有所变化/);
  assert.match(result.direction, /^本期信号主要涉及/);
  assert.match(result.nextQuestion, /安全与治理/);
});

test('unknown/no-data activity stays explicit, without invented judgment or future claims', () => {
  const empty = buildRadarAssessment(hotspot([], { previousCount: 3 }), []);
  assert.match(empty.activity, /不等同于技术停滞/);
  assert.match(empty.direction, /暂不形成方向判断/);
  const all = buildRadarAssessment(hotspot(['a'], { previousCount: null }), [
    signal('a', '一次现场交流'),
  ]);
  assert.match(all.activity, /没有可比的上一时段/);
  assert.match(all.direction, /未形成可稳定归纳的技术路径/);
  const sparse = buildRadarAssessment(hotspot(['a'], { trend: { state: 'insufficient' } }), [
    signal('a', '研究'),
  ]);
  assert.match(sparse.activity, /样本较少/);
});

test('representative roles require sourced profiles, not frequency, and avoid current-role inference', () => {
  const resources = [
    {
      id: 'person-chief',
      type: 'person',
      summary: 'A 是一家公司的首席执行官。',
      profileSourceUrl: 'https://example.org/a',
      recentCount: 1,
    },
    { id: 'person-unknown', type: 'person', summary: '声称是领域首席科学家', recentCount: 100 },
    {
      id: 'person-former',
      type: 'person',
      summary: 'B 曾任项目主任。',
      profileSourceUrl: 'https://example.org/b',
      recentCount: 3,
    },
    {
      id: 'person-negated',
      type: 'person',
      summary: 'C 并非项目负责人。',
      profileSourceUrl: 'https://example.org/c',
      recentCount: 3,
    },
    {
      id: 'organization',
      type: 'institution',
      summary: '研究机构',
      profileSourceUrl: 'https://example.org/o',
    },
  ];
  const result = buildRadarAssessment(hotspot([], { resources }), []);
  assert.equal(result.people.length, 4);
  assert.equal(result.people[0].roleLabel, '资料注明负责人');
  assert.equal(result.people[1].roleLabel, '关联人物');
  assert.equal(result.people[1].roleEvidence, undefined);
  assert.equal(result.people[2].roleLabel, '资料含历史职务');
  assert.equal(result.people[3].roleLabel, '已有身份资料');
  assert.ok(result.people.every((person) => !person.roleLabel.includes('领军')));
});

test('public radar projection bounds existing analysis and excludes tagged reasoning', () => {
  const base = {
    summary: '公开摘要',
    occurred_at: '2026-10-25T00:00:00Z',
    topics: [],
    entities: [],
    type: 'research',
    evidence: [],
    status: 'accepted',
    confidence: 3,
    novelty: 3,
    importance: 3,
  };
  const model = buildSignalRadar(
    [
      { ...base, id: 'a', title: '公开研判', analysis: '证据'.repeat(600) },
      {
        ...base,
        id: 'b',
        title: '内部标记不得展示',
        analysis: '<think>private reasoning</think>摘要',
      },
      { ...base, id: 'c', title: '无研判' },
    ],
    [],
    { now: new Date('2026-10-27T00:00:00Z') },
  );
  const [a, b, c] = ['a', 'b', 'c'].map((id) => model.signalIndex.find((s) => s.id === id));
  assert.equal([...a.analysis].length, 1000);
  assert.equal(a.analysisTruncated, true);
  assert.equal(b.analysis, undefined);
  assert.equal(c.analysis, undefined);
  const assessment = buildRadarAssessment(hotspot(['b']), [
    signal('b', '研究', undefined, { analysis: '<reasoning>private</reasoning>' }),
  ]);
  assert.deepEqual(assessment.judgments, []);
});
