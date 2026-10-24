import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSignalGenerationInvoker,
  generationInput,
  generationParticipantRules,
} from '../lib/signal-generation-provider.ts';
import { aiProfileDefaultPrompts } from '../lib/admin-ai-profile-defaults.ts';
import {
  GENERATION_METADATA_CONTRACT,
  GENERATION_RESOURCES_CONTRACT,
  GENERATION_SOURCE_PUBLICATION_CONTRACT,
  normalizeGeneratedCandidates,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';

const { Response, structuredClone } = globalThis;
const topics = [{ id: 'robot-learning', title: 'Robot Learning' }];
const ref = (fragment_id, quote) => ({ fragment_id, quote });
const source = {
  classification: 'private',
  fragments: [
    {
      id: 'fragment-1',
      text: 'AtlasVLA research. Published October 20, 2026. Report by journalist Nora Press for Daily Model.',
      locator: { paragraph: 1 },
    },
    {
      id: 'fragment-2',
      text: 'AtlasVLA was developed by paper authors Ada Chen and Bruno Lin.',
      locator: { paragraph: 2 },
    },
    {
      id: 'fragment-3',
      text: 'Ada Chen is affiliated with Northbridge University, which participated in the AtlasVLA research.',
      locator: { paragraph: 3 },
    },
    {
      id: 'fragment-4',
      text: 'Bruno Lin is a co-author of the AtlasVLA paper. His affiliation is not stated.',
      locator: { paragraph: 4 },
    },
    {
      id: 'fragment-5',
      text: 'Separate news. Published October 21, 2026. Delta Robotics released D4. Engineer Dana Wu at Delta Robotics developed D4.',
      locator: { paragraph: 5 },
    },
    {
      id: 'fragment-6',
      text: 'The AtlasVLA paper was published in Research Letters and deposited on PreprintHub.',
      locator: { paragraph: 6 },
    },
  ],
};
const authorRefs = [
  ref('fragment-2', 'AtlasVLA was developed by paper authors Ada Chen and Bruno Lin.'),
  ref(
    'fragment-3',
    'Ada Chen is affiliated with Northbridge University, which participated in the AtlasVLA research.',
  ),
];
const coauthorRefs = [ref('fragment-4', 'Bruno Lin is a co-author of the AtlasVLA paper.')];
const engineerRefs = [ref('fragment-5', 'Engineer Dana Wu at Delta Robotics developed D4.')];
const resource = (type, name, event_role, evidence) => ({
  type,
  name,
  introduction: null,
  event_role,
  evidence,
});
const candidates = [
  {
    title: 'AtlasVLA 提出机器人模型',
    summary: 'Ada Chen 与 Bruno Lin 共同研发 AtlasVLA。Northbridge University 参与该研究。',
    date_basis: 'source_published',
    event_date: '2026-10-20',
    event_date_evidence: [ref('fragment-1', 'Published October 20, 2026.')],
    persons: [
      {
        name: 'Ada Chen',
        role: '论文作者',
        organization: 'Northbridge University',
        evidence: authorRefs,
      },
      { name: 'Bruno Lin', role: '共同作者', organization: null, evidence: coauthorRefs },
    ],
    organizations: ['Northbridge University'],
    claims: [{ text: 'Ada Chen 与 Bruno Lin 研发 AtlasVLA。', evidence: [authorRefs[0]] }],
    topic_ids: ['robot-learning'],
    signal_type: 'research',
    resources: [
      resource('person', 'Ada Chen', '论文作者', authorRefs),
      resource('person', 'Bruno Lin', '共同作者', coauthorRefs),
      resource('institution', 'Northbridge University', '参与 AtlasVLA 研究', [authorRefs[1]]),
    ],
  },
  {
    title: 'Delta Robotics 发布 D4',
    summary: 'Delta Robotics 发布由工程师 Dana Wu 参与开发的 D4。',
    date_basis: 'source_published',
    event_date: '2026-10-21',
    event_date_evidence: [ref('fragment-5', 'Published October 21, 2026.')],
    persons: [
      { name: 'Dana Wu', role: '工程师', organization: 'Delta Robotics', evidence: engineerRefs },
    ],
    organizations: ['Delta Robotics'],
    claims: [
      {
        text: 'Delta Robotics 发布 D4。',
        evidence: [ref('fragment-5', 'Delta Robotics released D4.')],
      },
    ],
    topic_ids: ['robot-learning'],
    signal_type: 'product',
    resources: [
      resource('person', 'Dana Wu', '开发 D4', engineerRefs),
      resource('company', 'Delta Robotics', '发布 D4', engineerRefs),
    ],
  },
];

test('participant policy follows saved prompts for every contract without mutating source or profile', () => {
  const savedPrompt = '历史配置：仅看标题，忽略论文作者及其单位；用报道记者补足人物。';
  const before = JSON.stringify(source);
  const sourceHash = signalGenerationSourceHash(source);
  for (const contract of [
    undefined,
    GENERATION_METADATA_CONTRACT,
    GENERATION_RESOURCES_CONTRACT,
    GENERATION_SOURCE_PUBLICATION_CONTRACT,
  ]) {
    const input = generationInput(source, savedPrompt, topics, contract);
    const marker = '不可由配置提示词覆盖的参与者提取要求：';
    assert.ok(input.system.indexOf(marker) > input.system.indexOf(savedPrompt));
    assert.ok(input.system.includes(generationParticipantRules));
    const policy = input.system.slice(input.system.indexOf(marker));
    assert.match(policy, /论文作者、共同作者、研发者、研究团队成员/);
    assert.match(policy, /不只从标题或候选摘要挑选名字/);
    assert.match(policy, /报道作者.*论文作者／共同作者参与该研究/s);
    assert.match(policy, /期刊、会议、预印本平台只是发表渠道/);
    assert.match(policy, /保留该人物并设置 organization: null/);
    assert.match(policy, /分别引用同一事件的不同原文片段/);
    assert.match(policy, /不得借用其他新闻、其他候选/);
    assert.match(policy, /链接尚未读取.*不能声称已经查阅论文/s);
    const schema = input.schema.properties.candidates.items.properties;
    assert.match(schema.persons.description, /论文作者、共同作者、研发者/);
    assert.match(schema.persons.items.properties.organization.description, /为 null/);
    assert.match(schema.persons.items.properties.evidence.description, /不同片段/);
    assert.match(schema.organizations.description, /大学、研究院、实验室/);
    assert.deepEqual(JSON.parse(input.prompt).untrusted_source, source);
  }
  assert.equal(JSON.stringify(source), before);
  assert.equal(signalGenerationSourceHash(source), sourceHash);
  assert.match(aiProfileDefaultPrompts.extract, /主动阅读同一事件的作者列表、单位署名/);
  assert.match(aiProfileDefaultPrompts.extract, /研究成果作者不同于报道记者/);
});

async function invokeFixture(output, sourceInput = source) {
  const calls = [];
  const connection = {
    id: '11111111-1111-4111-8111-111111111111',
    revision: 1,
    protocol: 'openai-compatible',
    base_url: 'https://api.provider.example.com/v1',
    settings: { timeout_ms: 3000 },
  };
  const invoke = createSignalGenerationInvoker({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (request) => {
      calls.push(request);
      return Response.json({
        id: 'participant-extraction-fixture',
        model: 'fixture/model',
        choices: [
          {
            message: { role: 'assistant', content: JSON.stringify(output) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 300, completion_tokens: 200 },
      });
    },
  });
  const result = await invoke({
    source: sourceInput,
    topics,
    outputContract: GENERATION_SOURCE_PUBLICATION_CONTRACT,
    stage: {
      connection_id: connection.id,
      connection_revision: 1,
      model_id: 'fixture/model',
      prompt: '保留的历史提取配置',
      temperature: 0.7,
      max_output_tokens: 3000,
      require_tools: false,
    },
    connection,
    apiKey: 'synthetic-participant-fixture-key',
    allowedHosts: ['api.provider.example.com'],
  });
  return { result, calls };
}

test('single SDK request retains cross-fragment research authors and unknown affiliation without mixing separate events', async () => {
  const output = { candidates, reason: '两个有原文依据的技术事件。' };
  const before = JSON.stringify(output);
  const { result, calls } = await invokeFixture(output);
  assert.equal(calls.length, 1, 'no extra AI lookup or repair call');
  assert.equal(result.success, true);
  assert.deepEqual(result.output.rejected, []);
  assert.equal(result.output.candidates.length, 2);
  const [research, product] = result.output.candidates;
  assert.deepEqual(research.persons, candidates[0].persons);
  assert.deepEqual(research.resources, candidates[0].resources);
  assert.equal(research.persons[1].organization, null);
  assert.deepEqual(research.organizations, ['Northbridge University']);
  assert.deepEqual(
    product.persons.map((person) => person.name),
    ['Dana Wu'],
  );
  assert.deepEqual(product.organizations, ['Delta Robotics']);
  const names = result.output.candidates.flatMap((candidate) =>
    candidate.resources.map((r) => r.name),
  );
  for (const excluded of ['Nora Press', 'Daily Model', 'Research Letters', 'PreprintHub'])
    assert.equal(names.includes(excluded), false);
  const wire = JSON.parse(calls[0].body);
  assert.ok(
    wire.messages
      .find((message) => message.role === 'system')
      .content.includes(generationParticipantRules),
  );
  assert.equal(wire.tools, undefined);
  assert.equal(JSON.stringify(output), before);
  assert.doesNotThrow(() =>
    normalizeGeneratedCandidates(output, source, topics, GENERATION_SOURCE_PUBLICATION_CONTRACT),
  );
});

test('participant guidance does not invent people or units when supplied text has no identities', async () => {
  const anonymousSource = {
    classification: 'private',
    fragments: [
      { id: 'fragment-1', text: 'A new robot policy reduced latency.', locator: { paragraph: 1 } },
    ],
  };
  const candidate = {
    title: '机器人策略降低延迟',
    summary: '原文称一种新机器人策略降低延迟，未交代作者及单位。',
    date_basis: 'source_published',
    event_date: null,
    event_date_evidence: [],
    persons: [],
    organizations: [],
    resources: [],
    claims: [
      {
        text: '机器人策略降低延迟。',
        evidence: [ref('fragment-1', 'A new robot policy reduced latency.')],
      },
    ],
    topic_ids: ['robot-learning'],
    signal_type: 'research',
  };
  const { result, calls } = await invokeFixture(
    { candidates: [candidate], reason: '作者单位未知。' },
    anonymousSource,
  );
  assert.equal(calls.length, 1);
  assert.equal(result.success, true);
  assert.deepEqual(result.output.candidates[0].persons, []);
  assert.deepEqual(result.output.candidates[0].organizations, []);
  assert.deepEqual(result.output.candidates[0].resources, []);
  assert.ok(result.output.candidates[0].issues.includes('needs_person_evidence'));
});

test('positive participant guidance retains exact quote validation', async () => {
  const invalid = structuredClone(candidates[0]);
  invalid.persons[0].evidence[1].quote = 'Ada Chen is the director of Northbridge University.';
  const { result, calls } = await invokeFixture({
    candidates: [invalid],
    reason: '错误的职务引用。',
  });
  assert.equal(calls.length, 1);
  assert.equal(result.success, false);
  assert.equal(result.output?.candidates.length ?? 0, 0);
});
