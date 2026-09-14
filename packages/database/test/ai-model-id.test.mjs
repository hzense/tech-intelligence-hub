import { describe, expect, it, vi } from 'vitest';
import { isValidAiModelId } from '../src/ai-model-id.mjs';

describe('shared browser/server AI model ID predicate', () => {
  it.each([
    'a',
    'provider/model',
    'provider/model:v2.1',
    '~a',
    '~openai/gpt-astra-latest',
    '~provider/model:v2.1',
    'x'.repeat(200),
    `~${'x'.repeat(199)}`,
  ])('accepts exact bounded model ID %s', (value) => {
    expect(isValidAiModelId(value)).toBe(true);
  });
  it.each([
    undefined,
    null,
    1,
    {},
    [],
    '',
    '~',
    '~~provider/model',
    '~provider/~model',
    'provider/model~',
    '~.model',
    '~../model',
    'provider/model+variant',
    '~provider/model@version',
    '~provider/model?token=value',
    '~provider/model#fragment',
    '~provider/model%2fother',
    '~provider\\model',
    '~provider/model name',
    '~provider/模型',
    '~provider/model\n',
    '~provider/model\r',
    '~provider/model\t',
    ' ~provider/model',
    'x'.repeat(201),
    `~${'x'.repeat(200)}`,
  ])('rejects malformed model ID %j without normalization', (value) => {
    expect(isValidAiModelId(value)).toBe(false);
  });
  it('does not coerce object values or invoke proxy hooks', () => {
    const toString = vi.fn(() => '~provider/model');
    const get = vi.fn();
    expect(isValidAiModelId({ toString })).toBe(false);
    expect(isValidAiModelId(new Proxy({}, { get }))).toBe(false);
    expect(toString).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
