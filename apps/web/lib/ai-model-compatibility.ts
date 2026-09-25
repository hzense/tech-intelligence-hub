import { AiProbeError } from './ai-provider-transport.ts';

/** Provider-facing subset only. Business constraints remain in the local validator. */
export function portableJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const hints: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (
      [
        'minLength',
        'maxLength',
        'minItems',
        'maxItems',
        'pattern',
        'format',
        'uniqueItems',
      ].includes(key)
    ) {
      hints.push(`${key}: ${String(value)}`);
    } else if (key === 'properties') {
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, Record<string, unknown>>).map(([name, child]) => [
          name,
          portableJsonSchema(child),
        ]),
      );
    } else if (key === 'items') {
      result[key] = portableJsonSchema(value as Record<string, unknown>);
    } else if (key === 'anyOf') {
      result[key] = (value as Record<string, unknown>[]).map(portableJsonSchema);
    } else if (key === 'const') {
      // String enums are portable; boolean enums are not supported by every endpoint.
      if (typeof value === 'string') result.enum = [value];
      else hints.push(`Required value: ${String(value)}`);
    } else result[key] = value;
  }
  if (hints.length) result.description = [result.description, ...hints].filter(Boolean).join('; ');
  return result;
}

/** Read-only capability discovery via the same bounded, DNS-pinned transport.
 * Never guess model families or silently downgrade JSON Schema to plain text.
 */
export async function openRouterOptions(
  baseUrl: string,
  modelId: string,
  transport: typeof fetch,
  required: 'text' | 'structured' | 'tools',
  budget?: { inputTokens: number; outputTokens: number },
) {
  if (new URL(baseUrl).hostname !== 'openrouter.ai') return undefined;
  const response = await transport(`${baseUrl.replace(/\/$/, '')}/models`);
  const body = (await response.json()) as { data?: unknown };
  if (!Array.isArray(body?.data)) throw new AiProbeError('invalid_response');
  const model = body.data.find((entry) => entry?.id === modelId);
  if (!model || !Array.isArray(model.supported_parameters)) throw new AiProbeError('invalid_model');
  if (budget) {
    const context = model.top_provider?.context_length ?? model.context_length;
    const output = model.top_provider?.max_completion_tokens;
    if (
      (Number.isSafeInteger(context) &&
        context > 0 &&
        budget.inputTokens + budget.outputTokens > context) ||
      (Number.isSafeInteger(output) && output > 0 && budget.outputTokens > output)
    )
      throw new AiProbeError('capability_failed');
  }
  const parameters = model.supported_parameters as unknown[];
  if (
    !parameters.includes('max_tokens') ||
    (required === 'structured' &&
      (!parameters.includes('structured_outputs') || !parameters.includes('response_format'))) ||
    (required === 'tools' && (!parameters.includes('tools') || !parameters.includes('tool_choice')))
  )
    throw new AiProbeError('capability_failed');
  const reasoning: Record<string, string | boolean | number> = { exclude: true };
  const info = model.reasoning;
  if (info && parameters.includes('reasoning')) {
    const efforts = info.supported_efforts;
    // Optional thinking must be disabled before considering effort levels.
    if (info.mandatory === false) {
      reasoning.enabled = false;
      return { provider: { require_parameters: true }, reasoning };
    }
    if (info.mandatory !== true && Array.isArray(efforts) && efforts.includes('none')) {
      reasoning.effort = 'none';
      return { provider: { require_parameters: true }, reasoning };
    }
    const effort = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].find(
      (level) => efforts === null || (Array.isArray(efforts) && efforts.includes(level)),
    );
    if (effort) reasoning.effort = effort;
  }
  return { provider: { require_parameters: true }, reasoning };
}
