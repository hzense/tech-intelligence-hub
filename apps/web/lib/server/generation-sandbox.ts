import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Sandbox } from '@vercel/sandbox';
import { generationConfigured, generationDetail } from './signal-generation';
import { candidateEnrichmentConfigured, candidateEnrichmentDetail } from './candidate-enrichment';
import { readGenerationConfiguration } from '../signal-generation-config';
import { readAiBackendConfiguration } from '../admin-ai-core';
import { generationImportConfiguration } from './generation-import-reader';

export const generationSandboxTimeoutMs = 30 * 60 * 1000;
export const generationWorkerEnvironmentKeys = [
  'VERCEL_ENV',
  'HZENSE_GENERATION_WORKFLOW_ENABLED',
  'HZENSE_SIGNAL_GENERATION_ENABLED',
  'HZENSE_GENERATION_DATABASE_URL',
  'HZENSE_GENERATION_BATCH_LIMIT_MICROUSD',
  'HZENSE_GENERATION_DAILY_LIMIT_MICROUSD',
  'HZENSE_AI_DATABASE_URL',
  'HZENSE_AI_KEYRING',
  'HZENSE_AI_ALLOWED_HOSTS',
  'HZENSE_IMPORT_DATABASE_URL',
  'HZENSE_RUNTIME_EXPECTED_HOST',
  'HZENSE_RUNTIME_EXPECTED_PORT',
  'HZENSE_RUNTIME_EXPECTED_NAME',
  'HZENSE_RUNTIME_EXPECTED_USER',
] as const;
export type GenerationSandboxHandle = { sandboxName: string; commandId: string };

async function startSandbox(
  owner: string,
  id: string,
  kind: 'signal-generation' | 'candidate-enrichment',
  pending: () => Promise<boolean>,
): Promise<GenerationSandboxHandle | null> {
  // Validates ownership before any infrastructure allocation. The worker performs
  // the atomic claim/budget reservation; duplicate dispatch cannot call AI twice.
  if (!(await pending())) return null;
  const config = readGenerationConfiguration(process.env);
  const ai = readAiBackendConfiguration(process.env);
  const source = generationImportConfiguration();
  const env = Object.fromEntries(
    generationWorkerEnvironmentKeys
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]!]),
  );
  const worker = await readFile(join(process.cwd(), '.generation-worker/worker.cjs'));
  const signal = AbortSignal.timeout(120000);
  const sandbox = await Sandbox.create({
    runtime: 'node24',
    persistent: false,
    timeout: generationSandboxTimeoutMs,
    resources: { vcpus: 1 },
    signal,
    networkPolicy: {
      allow: [
        ...new Set(
          [config.connectionString, ai.connectionString, source.connectionString]
            .map((url) => new URL(url).hostname)
            .concat(ai.allowedHosts),
        ),
      ],
    },
  });
  try {
    await sandbox.writeFiles(
      [
        { path: '/vercel/sandbox/worker.cjs', content: worker },
        {
          path: '/vercel/sandbox/task.json',
          content: Buffer.from(JSON.stringify({ kind, owner, id, env })),
        },
      ],
      { signal },
    );
    const command = await sandbox.runCommand({
      cmd: 'node',
      args: ['/vercel/sandbox/worker.cjs'],
      detached: true,
      signal,
    });
    return { sandboxName: sandbox.name, commandId: command.cmdId };
  } catch {
    await sandbox.stop({ signal: AbortSignal.timeout(15000) }).catch(() => undefined);
    throw new Error('generation_dispatch_failed');
  }
}

export async function startGenerationSandbox(
  owner: string,
  id: string,
): Promise<GenerationSandboxHandle | null> {
  if (!generationConfigured()) throw new Error('not_configured');
  return startSandbox(
    owner,
    id,
    'signal-generation',
    async () => (await generationDetail(owner, id))?.status === 'pending',
  );
}

export async function startCandidateEnrichmentSandbox(
  owner: string,
  id: string,
): Promise<GenerationSandboxHandle | null> {
  if (!candidateEnrichmentConfigured()) throw new Error('not_configured');
  return startSandbox(
    owner,
    id,
    'candidate-enrichment',
    async () => (await candidateEnrichmentDetail(owner, id))?.status === 'pending',
  );
}
export async function pollGenerationSandbox(handle: GenerationSandboxHandle) {
  const signal = AbortSignal.timeout(15000);
  const sandbox = await Sandbox.get({ name: handle.sandboxName, resume: false, signal });
  const command = await sandbox.getCommand(handle.commandId, { signal });
  return command.exitCode === null ? 'running' : command.exitCode === 75 ? 'busy' : 'finished';
}
export async function stopGenerationSandbox(handle: GenerationSandboxHandle) {
  const signal = AbortSignal.timeout(15000);
  const sandbox = await Sandbox.get({ name: handle.sandboxName, resume: false, signal });
  await sandbox.stop({ signal });
}
