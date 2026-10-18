import process from 'node:process';
import {
  assessGeneratedCandidates,
  validateGenerationSource,
  type GenerationReference,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import type { AiProfile, AiConnection } from '../../../packages/database/src/ai-config-store.mjs';
import type {
  GenerationProviderInput,
  GenerationProviderResult,
} from './signal-generation-provider.ts';
import { isLocalDevelopment, LocalDevelopmentError } from './local-development.ts';
import {
  signalGenerationSourceHash,
  type SignalGenerationRun,
} from '../../../packages/database/src/signal-generation-store.mjs';

export const LOCAL_GENERATION_PROFILE_ID = '1389674e-ea29-4a37-a563-073f498fb7f2';
const connectionId = '62a986b6-4cd5-46ef-a4aa-e8e17ac8bdf6';
const modelId = 'local/deterministic-fixture-v1';
export const LOCAL_FIXTURE_SOURCE = 'https://example.invalid/hzense-local-fictional-fixture';

/** Reserved non-resolving test URL, never an internet evidence or verified source. */
export function localFixtureSourceOptions(run: SignalGenerationRun, env = process.env): string[] {
  const version = /^local-simulation-v1(?:\/retry\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?$/;
  if (
    !isLocalDevelopment(env) ||
    run.generation_version !== run.generation_version.trim() ||
    !version.test(run.generation_version) ||
    run.profile_id !== LOCAL_GENERATION_PROFILE_ID ||
    run.profile_revision !== 1 ||
    run.status !== 'completed'
  )
    return [];
  try {
    const source = validateGenerationSource(run.snapshot.source);
    if (
      run.source_hash !== signalGenerationSourceHash(source) ||
      !source.fragments.some((fragment) => fragment.text.includes('HZense 本地联调资料'))
    )
      return [];
  } catch {
    return [];
  }
  return [LOCAL_FIXTURE_SOURCE];
}
const prompt = '本地确定性模拟，仅用于验证导入、任务、审核和发布流程。不调用 AI，不代表真实分析。';
const stage = {
  connection_id: connectionId,
  connection_revision: 1,
  model_id: modelId,
  prompt,
  temperature: 0.5,
  max_output_tokens: 8192,
  require_tools: false,
};
const profile: AiProfile = {
  id: LOCAL_GENERATION_PROFILE_ID,
  revision: 1,
  name: '本地模拟 · 无 AI 调用 · 非真实模型',
  stages: { extract: stage, verify: stage, analyze: stage },
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
  readiness: { ready: true, reasons: [], warnings: ['仅本地模拟，不是供应商能力测试结果'] },
};
const connection: Pick<AiConnection, 'id' | 'revision' | 'protocol' | 'base_url' | 'settings'> = {
  id: connectionId,
  revision: 1,
  protocol: 'openai-compatible',
  // Reserved example domain; this adapter never sends an HTTP request.
  base_url: 'https://local-simulation.invalid/v1',
  settings: {
    timeout_ms: 30000,
    max_concurrency: 1,
    daily_budget_microusd: 1000000,
    input_price_microusd_per_million: 0,
    output_price_microusd_per_million: 0,
  },
};

export function localGenerationAccess(
  id = LOCAL_GENERATION_PROFILE_ID,
  revision = 1,
  credentials = false,
  env = process.env,
) {
  if (!isLocalDevelopment(env) || id !== profile.id || revision !== profile.revision)
    throw new LocalDevelopmentError();
  return {
    profile: structuredClone(profile),
    connection: structuredClone(connection),
    // An adapter marker, not a credential; never accepted by the network provider.
    ...(credentials ? { apiKey: 'local-simulation-no-provider-key' } : {}),
  };
}

/** A deliberately limited fixture adapter, not an AI or a heuristic news extractor. */
export async function invokeLocalGeneration(
  input: GenerationProviderInput,
  env = process.env,
): Promise<GenerationProviderResult> {
  if (
    !isLocalDevelopment(env) ||
    input.stage.model_id !== modelId ||
    input.connection.id !== connectionId ||
    input.connection.base_url !== connection.base_url
  )
    throw new LocalDevelopmentError();
  const field = (label: string) => {
    for (const fragment of input.source.fragments) {
      const line = fragment.text.split('\n').find((text) => text.startsWith(`${label}：`));
      if (!line || Array.from(line).length > 500) continue;
      const value = line.slice(label.length + 1).trim();
      if (!value) continue;
      return {
        value,
        evidence: [{ fragment_id: fragment.id, quote: line }] as GenerationReference[],
      };
    }
    return null;
  };
  const marked = input.source.fragments.some((fragment) =>
    fragment.text.includes('HZense 本地联调资料'),
  );
  const title = field('标题'),
    summary = field('摘要'),
    date = field('日期');
  const person = field('人物'),
    organization = field('组织'),
    topic = field('领域');
  const ready = marked && title && summary && date && person && organization && topic;
  const candidates = ready
    ? [
        {
          title: `【本地模拟】${title.value}`,
          summary: summary.value,
          event_date: date.value,
          event_date_evidence: date.evidence,
          persons: [
            {
              name: person.value,
              role: '本地联调资料中的人物',
              organization: null,
              evidence: person.evidence,
            },
          ],
          organizations: [organization.value],
          claims: [{ text: summary.value, evidence: summary.evidence }],
          topic_ids: [topic.value],
          signal_type: 'technology',
          resources: [
            {
              type: 'person',
              name: person.value,
              introduction: null,
              event_role: null,
              evidence: person.evidence,
            },
            {
              type: 'company',
              name: organization.value,
              introduction: null,
              event_role: null,
              evidence: organization.evidence,
            },
          ],
        },
      ]
    : [];
  const output = assessGeneratedCandidates(
    {
      candidates,
      reason: ready
        ? '本地确定性模拟结果，不代表真实 AI 分析或公开事实。'
        : '本地模拟仅处理 HZense 本地联调资料模板；普通资料已解析，但未调用真实模型。',
    },
    input.source,
    input.topics,
    input.outputContract,
  );
  return { success: true, output, input_tokens: 0, output_tokens: 0 };
}
