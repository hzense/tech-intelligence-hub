import 'server-only';

import { AutomationError } from '../../../../packages/database/src/automation-contract.mjs';
import { readRuntimeLeafTopics } from './runtime-reader';
import { readTaskPublicSignals } from './task-public-signals';
import { trackedTopicIds } from '../tracking-topics';

type TrackingSignal = { id: string; topics: readonly string[] };

/** Database-only selection shared by configuration, dispatch and cloud workers. */
export async function readInsightLeafTopics() {
  try {
    return await readRuntimeLeafTopics();
  } catch {
    // Preserve an unavailable catalog as an error, never an empty allowed set
    // or a raw database message containing connection information.
    throw new AutomationError('database_unavailable');
  }
}

function assertTopicSelection(topicIds: readonly string[]) {
  if (
    !Array.isArray(topicIds) ||
    topicIds.length < 1 ||
    topicIds.length > 5 ||
    topicIds.some((id) => typeof id !== 'string') ||
    new Set(topicIds).size !== topicIds.length
  )
    throw new AutomationError('insight_topic_not_leaf');
}

export async function assertInsightLeafTopics(topicIds: readonly string[]): Promise<void> {
  assertTopicSelection(topicIds);
  const allowed = new Set((await readInsightLeafTopics()).map((topic) => topic.id));
  if (topicIds.some((id) => !allowed.has(id))) throw new AutomationError('insight_topic_not_leaf');
}

async function trackingContext(signals?: readonly TrackingSignal[]) {
  const [leaves, current] = await Promise.all([
    readInsightLeafTopics(),
    signals ??
      readTaskPublicSignals().catch(() => {
        throw new AutomationError('database_unavailable');
      }),
  ]);
  const nonRootLeaves = new Set(
    leaves
      .filter((topic) => typeof topic.parentId === 'string' && topic.parentId.length > 0)
      .map((topic) => topic.id),
  );
  return { leaves, tracked: trackedTopicIds(nonRootLeaves, current) };
}

/** Eligibility uses all current public Signals; the report's 30-day window is separate. */
export async function readTrackedInsightTopics(signals?: readonly TrackingSignal[]) {
  const { leaves, tracked } = await trackingContext(signals);
  return leaves.filter((topic) => tracked.has(topic.id));
}

export async function assertTrackedInsightTopics(
  topicIds: readonly string[],
  signals?: readonly TrackingSignal[],
): Promise<void> {
  assertTopicSelection(topicIds);
  const { leaves, tracked } = await trackingContext(signals);
  const allowedLeaves = new Set(leaves.map((topic) => topic.id));
  if (topicIds.some((id) => !allowedLeaves.has(id)))
    throw new AutomationError('insight_topic_not_leaf');
  if (topicIds.some((id) => !tracked.has(id)))
    throw new AutomationError('insight_topic_not_tracked');
}
