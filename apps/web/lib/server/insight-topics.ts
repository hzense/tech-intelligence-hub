import 'server-only';

import { AutomationError } from '../../../../packages/database/src/automation-contract.mjs';
import { readRuntimeLeafTopics } from './runtime-reader';

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

export async function assertInsightLeafTopics(topicIds: readonly string[]): Promise<void> {
  if (
    !Array.isArray(topicIds) ||
    topicIds.length < 1 ||
    topicIds.length > 5 ||
    topicIds.some((id) => typeof id !== 'string') ||
    new Set(topicIds).size !== topicIds.length
  )
    throw new AutomationError('insight_topic_not_leaf');
  const allowed = new Set((await readInsightLeafTopics()).map((topic) => topic.id));
  if (topicIds.some((id) => !allowed.has(id))) throw new AutomationError('insight_topic_not_leaf');
}
