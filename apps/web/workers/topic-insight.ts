import { readFile, unlink } from 'node:fs/promises';
import { automationPool } from '../lib/server/automation-store-access';
import {
  readAutomationRun,
  updateAutomationRun,
} from '../../../packages/database/src/automation-store.mjs';
import { executeTopicInsight } from '../lib/server/topic-insight-executor';

async function main() {
  const path = '/vercel/sandbox/task.json';
  const { owner, id, env } = JSON.parse(await readFile(path, 'utf8'));
  await unlink(path);
  Object.assign(process.env, env);
  const run = await readAutomationRun({ pool: automationPool, owner, id });
  if (run.status !== 'running' || run.snapshot.kind !== 'topic_insight' || !run.lease_token) return;
  let executionCompleted = false;
  try {
    const completion = await executeTopicInsight(owner, run);
    executionCompleted = true;
    await updateAutomationRun({
      pool: automationPool,
      owner,
      id,
      token: run.lease_token,
      phase: 'ready_for_review',
      result: { ...completion.result },
      status: 'completed',
      costMicrousd: completion.costMicrousd,
      costSource: completion.costSource,
    });
  } catch (error) {
    // A provider failure can have incurred a charge. Keep the entire reservation.
    const code =
      error instanceof Error && /^[a-z][a-z0-9_]{0,79}$/.test(error.message)
        ? error.message
        : 'outcome_unknown';
    const topicRefusal =
      !executionCompleted &&
      [
        'insight_topic_not_leaf',
        'insight_topic_not_tracked',
        'insight_insufficient_evidence',
      ].includes(code);
    await updateAutomationRun({
      pool: automationPool,
      owner,
      id,
      token: run.lease_token,
      phase: 'failed',
      result: {},
      status: topicRefusal ? 'failed' : 'unknown',
      errorCode: code,
      ...(topicRefusal ? { costMicrousd: 0 } : {}),
      costSource: topicRefusal ? 'estimate' : 'reserve',
    }).catch(() => undefined);
  }
}
main().then(
  () => process.exit(0),
  () => process.exit(1),
);
