import type { GenerationAccess } from './signal-generation-core.ts';
import { generationCost } from './signal-generation-core.ts';
import type { AutomationConfig } from '../../../packages/database/src/automation-contract.mjs';
import {
  createPinnedAiFetch,
  type AiResolver,
  type AiWireRequest,
} from './ai-provider-transport.ts';
import { openRouterOptions } from './ai-model-compatibility.ts';
import { readApiCostMicrousd } from './ai-response-cost.ts';
import {
  readDiscoveryDiagnostics,
  type DiscoveryDiagnostics,
} from './source-discovery-diagnostics.ts';
import {
  discoveryOutputTokens,
  discoverySearchLimit,
  discoveryRules,
  discoveryWindow,
  parseDiscoveryResponse,
} from './source-discovery-core.ts';

export class DiscoveryFailure extends Error {
  readonly code: string;
  readonly called: boolean;
  readonly costMicrousd: number | null;
  readonly diagnostics: DiscoveryDiagnostics | undefined;
  constructor(
    code: string,
    called = false,
    costMicrousd: number | null = null,
    diagnostics?: DiscoveryDiagnostics,
  ) {
    super(code);
    this.code = code;
    this.called = called;
    this.costMicrousd = costMicrousd;
    this.diagnostics = diagnostics;
  }
}
export function assertDiscoveryConnection(access: GenerationAccess) {
  const stage = access.profile.stages.analyze;
  if (
    access.connection.protocol !== 'openai-compatible' ||
    access.connection.base_url.replace(/\/$/, '') !== 'https://openrouter.ai/api/v1' ||
    stage.connection_id !== access.connection.id ||
    stage.connection_revision !== access.connection.revision
  )
    throw new DiscoveryFailure('discovery_connection_unsupported');
}
export function discoveryEstimate(access: GenerationAccess) {
  // Up to four inference passes, eight excerpts of <=1,000 characters plus tool/prompt overhead.
  // Search fee is an estimate, not a contractual provider price cap (reviewed 2026-09-30).
  return (
    generationCost(
      30000 * (discoverySearchLimit + 1),
      discoveryOutputTokens * (discoverySearchLimit + 1),
      access.connection.settings,
    ) +
    7000 * discoverySearchLimit
  );
}
export function createDiscoveryInvoker(
  dependencies: { resolve?: AiResolver; request?: AiWireRequest } = {},
) {
  return async (input: {
    access: GenerationAccess;
    config: AutomationConfig;
    now: Date | string;
    topics: { id: string; name: string }[];
    knownUrls: string[];
    allowedHosts: readonly string[];
    beforeCall(): Promise<void>;
  }) => {
    assertDiscoveryConnection(input.access);
    if (!input.access.apiKey || !input.config.discovery)
      throw new DiscoveryFailure('invalid_discovery_configuration');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    let cost: number | null = null,
      called = false;
    let diagnostics: DiscoveryDiagnostics | undefined;
    try {
      const { connection, profile, apiKey } = input.access;
      const transport = createPinnedAiFetch(
        {
          baseUrl: connection.base_url,
          apiKey,
          allowedHosts: input.allowedHosts,
          signal: controller.signal,
        },
        dependencies,
      );
      const options = await openRouterOptions(
        connection.base_url,
        profile.stages.analyze.model_id,
        transport,
        'tools',
        { inputTokens: 30000, outputTokens: discoveryOutputTokens },
      );
      const window = discoveryWindow(input.config, input.now);
      await input.beforeCall();
      called = true;
      // Raw compatible transport is intentional: SDK tool conversion must not strip the
      // OpenRouter-owned server tool, annotations, search usage or account cost receipt.
      const response = await transport(
        `${connection.base_url.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          body: JSON.stringify({
            model: profile.stages.analyze.model_id,
            messages: [
              { role: 'system', content: discoveryRules },
              {
                role: 'user',
                content: JSON.stringify({
                  topics: input.topics,
                  keywords: input.config.discovery.keywords,
                  ...window,
                  maxSources: input.config.discovery.maxSources,
                }),
              },
            ],
            tools: [
              {
                type: 'openrouter:web_search',
                parameters: {
                  engine: 'exa',
                  mode: 'fast',
                  max_uses: discoverySearchLimit,
                  max_results: 8,
                  max_total_results: 8,
                  max_characters: 1000,
                },
              },
            ],
            max_tool_calls: discoverySearchLimit,
            // Supplying a server tool alone allows zero searches. Require its use,
            // retaining both loop limits (this does not promise exactly one search).
            tool_choice: 'required',
            max_tokens: discoveryOutputTokens,
            stream: false,
            ...options,
          }),
        },
      );
      cost = await readApiCostMicrousd(response, connection.base_url);
      const body: unknown = await response.json();
      diagnostics = readDiscoveryDiagnostics(body);
      const result = parseDiscoveryResponse(body, input.config, window, input.knownUrls);
      return {
        result,
        diagnostics,
        costMicrousd: cost ?? discoveryEstimate(input.access),
        costSource: cost === null ? ('estimate' as const) : ('provider' as const),
      };
    } catch (error) {
      const code =
        error instanceof Error &&
        [
          'discovery_search_unconfirmed',
          'discovery_invalid_output',
          'discovery_provider_error',
          'discovery_output_truncated',
          'capability_failed',
          'invalid_model',
          'provider_rejected',
          'timeout',
          'stale_attempt',
        ].includes(error.message)
          ? error.message
          : 'discovery_unavailable';
      throw new DiscoveryFailure(code, called, cost, diagnostics);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
export const invokeSourceDiscovery = createDiscoveryInvoker();
