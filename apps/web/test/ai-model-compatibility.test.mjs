import assert from 'node:assert/strict';
import test from 'node:test';
import { openRouterOptions, portableJsonSchema } from '../lib/ai-model-compatibility.ts';
import { generationCandidateJsonSchema } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
const { Response } = globalThis;
const url = 'https://openrouter.ai/api/v1';
const parameters = ['max_tokens', 'response_format', 'structured_outputs', 'reasoning'];
const models = [
  ['openai/gpt-6-astra', ['low', 'medium', 'high'], true, 'low'],
  ['anthropic/claude-fable-5.1', ['low', 'medium', 'high'], true, 'low'],
  ['google/gemini-3.8-flash', ['minimal', 'low', 'medium', 'high'], true, 'minimal'],
  ['deepseek/deepseek-v4.1-flash', ['high', 'max'], false, 'high'],
  ['qwen/qwen3.8-max-0902', ['high', 'xhigh'], true, 'high'],
  ['z-ai/glm-5.3', ['max', 'high', 'low'], true, 'low'],
  ['z-ai/glm-5.2', ['xhigh', 'high'], false, 'high'],
  ['moonshotai/kimi-k3', ['max', 'high', 'low'], false, 'low'],
  ['moonshotai/kimi-k2.6', undefined, false, undefined],
];
for (const [id, efforts, mandatory, expected] of models) {
  test(`catalog-driven options: ${id}`, async () => {
    let calls = 0;
    const options = await openRouterOptions(
      url,
      id,
      async (target) => {
        calls++;
        assert.equal(target, `${url}/models`);
        return Response.json({
          data: [
            {
              id,
              supported_parameters: parameters,
              reasoning: { supported_efforts: efforts, mandatory },
            },
          ],
        });
      },
      'structured',
    );
    assert.equal(calls, 1);
    assert.equal(options.provider.require_parameters, true);
    assert.equal(options.reasoning.exclude, true);
    assert.equal(options.reasoning.effort, expected);
    if (!expected) assert.equal(options.reasoning.enabled, false);
  });
}
test('unknown, unsupported and malformed catalogs fail closed; no fallback requests', async () => {
  for (const data of [
    [],
    [{ id: 'model', supported_parameters: ['max_tokens', 'response_format'] }],
    [{ id: 'model' }],
  ]) {
    let calls = 0;
    await assert.rejects(
      openRouterOptions(
        url,
        'model',
        async () => {
          calls++;
          return Response.json({ data });
        },
        'structured',
      ),
    );
    assert.equal(calls, 1);
  }
});
test('other providers never receive OpenRouter metadata requests or options', async () => {
  assert.equal(
    await openRouterOptions(
      'https://example.com/v1',
      'model',
      async () => {
        assert.fail('must not fetch');
      },
      'structured',
    ),
    undefined,
  );
});
test('portable schema removes provider-specific constraints without mutating business contract', () => {
  const before = JSON.stringify(generationCandidateJsonSchema);
  const portable = portableJsonSchema(generationCandidateJsonSchema);
  function visit(node) {
    for (const key of [
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
      'uniqueItems',
      'format',
      'pattern',
      'const',
    ])
      assert.equal(Object.hasOwn(node, key), false);
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(visit);
    }
    if (node.items) visit(node.items);
    if (node.anyOf) node.anyOf.forEach(visit);
  }
  visit(portable);
  assert.match(portable.properties.candidates.items.properties.summary.description, /500/);
  assert.equal(JSON.stringify(generationCandidateJsonSchema), before);
});
