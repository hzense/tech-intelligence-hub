import { generateText, Output, jsonSchema, tool, isStepCount, type LanguageModelUsage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { readApiCostMicrousd } from './ai-response-cost.ts';
import { Buffer } from 'node:buffer';
import { openRouterOptions, portableJsonSchema } from './ai-model-compatibility.ts';
import { isValidAiModelId } from '../../../packages/database/src/ai-model-id.mjs';
import { AI_PROBE_OUTPUT_TOKENS } from '../../../packages/database/src/ai-config-contract.mjs';
import {
  AiProbeError,
  createPinnedAiFetch,
  type AiProbeErrorCode,
  type AiResolver,
  type AiWireRequest,
} from './ai-provider-transport.ts';

export const aiProbeSentinel = 'HZENSE_PROBE_OK';
export type AiProbeKind = 'models' | 'connection' | 'structured_output' | 'tool_calling';
export interface AiProbeInput {
  connection: {
    id: string;
    revision: number;
    protocol: string;
    base_url: string;
    settings: { timeout_ms: number };
  };
  apiKey: string;
  kind: AiProbeKind;
  modelId?: string;
  allowedHosts: readonly string[] | ReadonlySet<string>;
}
export interface AiProbeResult {
  provider_cost_microusd?: number | null;
  success: boolean;
  model_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  result: Record<string, unknown>;
  error_code?: AiProbeErrorCode;
}
export function validAiModelId(value: unknown): value is string {
  return isValidAiModelId(value);
}
function validSentinel(value: unknown): value is { sentinel: string; ok: true } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 2 && row.sentinel === aiProbeSentinel && row.ok === true;
}
const schema = jsonSchema<{ sentinel: string; ok: true }>(
  portableJsonSchema({
    type: 'object',
    properties: {
      sentinel: { type: 'string', const: aiProbeSentinel },
      ok: { type: 'boolean', const: true },
    },
    required: ['sentinel', 'ok'],
    additionalProperties: false,
  }),
  {
    validate: (value) =>
      validSentinel(value)
        ? { success: true, value }
        : { success: false, error: new Error('invalid_probe_output') },
  },
);

function errorCode(error: unknown): AiProbeErrorCode {
  let current = error;
  for (let index = 0; index < 5 && current instanceof Error; index++) {
    if (current instanceof AiProbeError) return current.code;
    if (current.name === 'AbortError' || current.name === 'TimeoutError') return 'timeout';
    current = current.cause;
  }
  // Never return provider/SDK error messages, headers or response bodies.
  return 'capability_failed';
}
const tokens = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Server-owned transport injection for regression tests; never caller-supplied. */
export function createAiProbeInvoker(
  dependencies: { resolve?: AiResolver; request?: AiWireRequest } = {},
) {
  return async (input: AiProbeInput): Promise<AiProbeResult> => {
    const safeModel =
      validAiModelId(input.modelId) && !input.modelId.includes(input.apiKey) ? input.modelId : null;
    const base: AiProbeResult = {
      success: false,
      model_id: input.kind === 'models' ? null : safeModel,
      input_tokens: null,
      output_tokens: null,
      result: {},
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const timeout = input.connection.settings.timeout_ms;
      if (
        input.connection.protocol !== 'openai-compatible' ||
        typeof timeout !== 'number' ||
        !Number.isInteger(timeout) ||
        timeout < 3000 ||
        timeout > 20000 ||
        typeof input.apiKey !== 'string' ||
        input.apiKey.length < 8 ||
        input.apiKey.length > 4096 ||
        [...input.apiKey].some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126) ||
        !['models', 'connection', 'structured_output', 'tool_calling'].includes(input.kind)
      )
        throw new AiProbeError('invalid_configuration');
      if (input.kind !== 'models' && safeModel === null) throw new AiProbeError('invalid_model');
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AiProbeError('timeout'));
        }, timeout);
      });
      const transport = createPinnedAiFetch(
        {
          baseUrl: input.connection.base_url,
          allowedHosts: [...input.allowedHosts],
          apiKey: input.apiKey,
          signal: controller.signal,
        },
        dependencies,
      );
      const operation = async (): Promise<AiProbeResult> => {
        if (input.kind === 'models') {
          const response = await transport(
            `${input.connection.base_url.replace(/\/$/, '')}/models`,
          );
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            throw new AiProbeError('invalid_response');
          }
          if (
            !body ||
            typeof body !== 'object' ||
            !Array.isArray((body as { data?: unknown }).data)
          )
            throw new AiProbeError('invalid_response');
          const data = (body as { data: unknown[] }).data;
          const models: { id: string }[] = [];
          const seen = new Set<string>();
          let bytes = 0;
          let truncated = false;
          for (const entry of data) {
            if (models.length === 200) {
              truncated = true;
              break;
            }
            if (
              !entry ||
              typeof entry !== 'object' ||
              !validAiModelId((entry as { id?: unknown }).id)
            )
              throw new AiProbeError('invalid_response');
            const id = (entry as { id: string }).id;
            if (id.includes(input.apiKey)) throw new AiProbeError('invalid_response');
            if (seen.has(id)) continue;
            if (bytes + Buffer.byteLength(id) > 12000) {
              truncated = true;
              break;
            }
            seen.add(id);
            bytes += Buffer.byteLength(id);
            models.push({ id });
          }
          return {
            ...base,
            success: true,
            result: { models, count: models.length, truncated },
          };
        }
        const routerOptions = await openRouterOptions(
          input.connection.base_url,
          safeModel!,
          transport,
          input.kind === 'structured_output'
            ? 'structured'
            : input.kind === 'tool_calling'
              ? 'tools'
              : 'text',
        );
        const provider = createOpenAICompatible({
          name: 'hzense-compatible',
          baseURL: input.connection.base_url,
          apiKey: input.apiKey,
          fetch: async (url, init) => {
            const response = await transport(url, init);
            if (init?.method === 'POST') {
              const cost = await readApiCostMicrousd(response, input.connection.base_url);
              if (cost !== null) base.provider_cost_microusd = cost;
            }
            return response;
          },
          supportsStructuredOutputs: true,
        });
        const common = {
          model: provider.chatModel(safeModel!),
          maxRetries: 0,
          maxOutputTokens: AI_PROBE_OUTPUT_TOKENS,
          ...(routerOptions ? { providerOptions: { hzenseCompatible: routerOptions } } : {}),
          abortSignal: controller.signal,
          stopWhen: isStepCount(1),
          onStepEnd: ({ usage }: { usage: LanguageModelUsage }) => {
            // A rejected capability check can still be a billable provider call.
            // Keep safe observed usage without returning generated content.
            base.input_tokens = tokens(usage.inputTokens);
            base.output_tokens = tokens(usage.outputTokens);
          },
        };
        if (input.kind === 'structured_output') {
          const result = await generateText({
            ...common,
            output: Output.object({ schema }),
            prompt: `Return exactly {"sentinel":"${aiProbeSentinel}","ok":true}.`,
          });
          if (!validSentinel(result.output) || result.toolCalls.length)
            throw new AiProbeError('capability_failed');
          return {
            ...base,
            success: true,
            input_tokens: tokens(result.usage.inputTokens),
            output_tokens: tokens(result.usage.outputTokens),
            result: { schema_valid: true, sentinel_matched: true },
          };
        }
        if (input.kind === 'tool_calling') {
          // No execute callback: verify one real tool-call and its schema only.
          // Model-chosen names/arguments can never execute code or external tools.
          const result = await generateText({
            ...common,
            tools: {
              echo: tool({
                description: 'Echo the fixed harmless probe sentinel.',
                inputSchema: schema,
              }),
            },
            toolChoice: { type: 'tool', toolName: 'echo' },
            prompt: `Call echo once with {"sentinel":"${aiProbeSentinel}","ok":true}.`,
          });
          const call = result.toolCalls[0];
          if (
            result.toolCalls.length !== 1 ||
            !call ||
            call.toolName !== 'echo' ||
            call.invalid ||
            !validSentinel(call.input)
          )
            throw new AiProbeError('capability_failed');
          return {
            ...base,
            success: true,
            input_tokens: tokens(result.usage.inputTokens),
            output_tokens: tokens(result.usage.outputTokens),
            result: { tool_called: true, arguments_valid: true },
          };
        }
        const result = await generateText({
          ...common,
          prompt: `Reply with exactly ${aiProbeSentinel} and no other text.`,
        });
        if (result.text.trim() !== aiProbeSentinel || result.toolCalls.length)
          throw new AiProbeError('capability_failed');
        return {
          ...base,
          success: true,
          input_tokens: tokens(result.usage.inputTokens),
          output_tokens: tokens(result.usage.outputTokens),
          result: { sentinel_matched: true },
        };
      };
      return await Promise.race([operation(), deadline]);
    } catch (error) {
      return { ...base, error_code: errorCode(error) };
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  };
}
export const invokeAiProbe = createAiProbeInvoker();
