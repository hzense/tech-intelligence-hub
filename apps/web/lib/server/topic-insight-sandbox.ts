import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Sandbox } from '@vercel/sandbox';
import { automationPool } from './automation-store-access';
import { readAutomationRun } from '../../../../packages/database/src/automation-store.mjs';
import { readAiBackendConfiguration } from '../admin-ai-core';

export type TopicInsightSandboxHandle = { sandboxName: string; commandId: string };
const keys = [
  'VERCEL_ENV',
  'HZENSE_AUTOMATION_ENABLED',
  'HZENSE_AUTOMATION_DATABASE_URL',
  'HZENSE_AI_DATABASE_URL',
  'HZENSE_AI_KEYRING',
  'HZENSE_AI_ALLOWED_HOSTS',
  'HZENSE_RUNTIME_DATABASE_URL',
  'HZENSE_RUNTIME_EXPECTED_HOST',
  'HZENSE_RUNTIME_EXPECTED_PORT',
  'HZENSE_RUNTIME_EXPECTED_NAME',
  'HZENSE_RUNTIME_EXPECTED_USER',
  'HZENSE_SIGNAL_READ_MODE',
  'HZENSE_EDITORIAL_PUBLICATION_ENABLED',
  'HZENSE_EDITORIAL_READER_DATABASE_URL',
] as const;
export async function startTopicInsightSandbox(
  owner: string,
  id: string,
): Promise<TopicInsightSandboxHandle | null> {
  const run = await readAutomationRun({ pool: automationPool, owner, id });
  if (run.status !== 'running' || !run.lease_token || run.snapshot.kind !== 'topic_insight')
    return null;
  const ai = readAiBackendConfiguration(process.env);
  const databaseUrls = [
    process.env.HZENSE_AUTOMATION_DATABASE_URL,
    ai.connectionString,
    process.env.HZENSE_RUNTIME_DATABASE_URL,
    process.env.HZENSE_EDITORIAL_READER_DATABASE_URL,
  ].filter(Boolean) as string[];
  const allow = [
    ...new Set([...databaseUrls.map((url) => new URL(url).hostname), ...ai.allowedHosts]),
  ];
  const env = Object.fromEntries(
    keys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]!]),
  );
  const worker = await readFile(join(process.cwd(), '.automation-worker/worker.cjs'));
  const signal = AbortSignal.timeout(120000);
  const sandbox = await Sandbox.create({
    runtime: 'node24',
    persistent: false,
    timeout: 30 * 60 * 1000,
    resources: { vcpus: 1 },
    signal,
    networkPolicy: { allow },
  });
  try {
    await sandbox.writeFiles(
      [
        { path: '/vercel/sandbox/worker.cjs', content: worker },
        {
          path: '/vercel/sandbox/task.json',
          content: Buffer.from(JSON.stringify({ owner, id, env })),
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
    throw new Error('dispatch_unknown');
  }
}
export async function pollTopicInsightSandbox(handle: TopicInsightSandboxHandle) {
  const signal = AbortSignal.timeout(15000);
  const sandbox = await Sandbox.get({ name: handle.sandboxName, resume: false, signal });
  const command = await sandbox.getCommand(handle.commandId, { signal });
  return command.exitCode === null ? 'running' : 'finished';
}
export async function stopTopicInsightSandbox(handle: TopicInsightSandboxHandle) {
  const signal = AbortSignal.timeout(15000);
  const sandbox = await Sandbox.get({ name: handle.sandboxName, resume: false, signal });
  await sandbox.stop({ signal });
}
