import assert from 'node:assert/strict';
import test from 'node:test';
import { assessCandidateEnrichment } from '../src/candidate-enrichment-contract.mjs';

const text = '2026-09-20，研究作者李明在示例研究所发布了新的模型评测。';
const source = {
  classification: 'private',
  fragments: [{ id: 'fragment-1', text, locator: { paragraph: 1 } }],
};
const reference = (quote) => ({ fragment_id: 'fragment-1', quote });
const candidate = {
  index: 2,
  title: '示例研究所发布模型评测',
  summary: '示例研究所发布了新的模型评测，候选仍待审核。',
  event_date: null,
  event_date_evidence: [],
  persons: [],
  organizations: [],
  claims: [{ text: '发布新的模型评测', evidence: [reference('发布了新的模型评测')] }],
  classification: 'private',
  status: 'needs_review',
  issues: ['needs_public_evidence', 'needs_person_evidence', 'needs_event_time'],
};

test('enrichment only fills bounded fields and keeps the original candidate content private', () => {
  const result = assessCandidateEnrichment(
    {
      event_date: '2026-09-20',
      event_date_evidence: [reference('2026-09-20')],
      persons: [
        {
          name: '李明',
          role: '研究作者',
          organization: '示例研究所',
          evidence: [reference('研究作者李明在示例研究所')],
        },
      ],
      organizations: ['示例研究所'],
    },
    candidate,
    source,
  );
  assert.equal(result.classification, 'private');
  assert.equal(result.validation_version, 1);
  assert.equal(result.candidate.index, 2);
  assert.equal(result.candidate.title, candidate.title);
  assert.equal(result.candidate.summary, candidate.summary);
  assert.deepEqual(result.candidate.claims, candidate.claims);
  assert.equal(result.candidate.event_date, '2026-09-20');
  assert.equal(result.candidate.persons[0].name, '李明');
  assert.deepEqual(result.candidate.issues, ['needs_public_evidence']);
});

test('enrichment rejects invented evidence and authority fields', () => {
  const valid = {
    event_date: '2026-09-20',
    event_date_evidence: [reference('2026-09-20')],
    persons: [],
    organizations: ['示例研究所'],
  };
  assert.throws(
    () =>
      assessCandidateEnrichment(
        { ...valid, event_date_evidence: [reference('不存在的日期证据')] },
        candidate,
        source,
      ),
    { code: 'invalid_enrichment_output' },
  );
  assert.throws(() => assessCandidateEnrichment({ ...valid, verified: true }, candidate, source), {
    code: 'invalid_enrichment_output',
  });
  assert.throws(
    () =>
      assessCandidateEnrichment({ ...valid, organizations: ['不存在的组织'] }, candidate, source),
    { code: 'invalid_enrichment_output' },
  );
});

test('enrichment never overwrites an existing date, people, claims or organizations', () => {
  const existing = {
    ...candidate,
    event_date: '2026-09-20',
    event_date_evidence: [reference('2026-09-20')],
    persons: [
      {
        name: '李明',
        role: '研究作者',
        organization: '示例研究所',
        evidence: [reference('研究作者李明在示例研究所')],
      },
    ],
    organizations: ['示例研究所'],
  };
  const result = assessCandidateEnrichment(
    {
      event_date: null,
      event_date_evidence: [],
      persons: [],
      organizations: [],
    },
    existing,
    source,
  );
  assert.equal(result.candidate.event_date, '2026-09-20');
  assert.deepEqual(result.candidate.persons, existing.persons);
  assert.deepEqual(result.candidate.organizations, existing.organizations);
  assert.deepEqual(result.candidate.claims, existing.claims);
});

test('enrichment rejects accessor-backed output without executing it', () => {
  let accessed = false;
  const output = {
    event_date: null,
    event_date_evidence: [],
    persons: [],
    organizations: [],
  };
  Object.defineProperty(output, 'event_date', {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error('must not execute');
    },
  });
  assert.throws(() => assessCandidateEnrichment(output, candidate, source), {
    code: 'invalid_enrichment_output',
  });
  assert.equal(accessed, false);
});
