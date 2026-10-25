type Topic = { id: string; name: string };

/** A narrower child label cannot stand in for a complete discovery domain. */
export function unavailableDiscoveryTopics(
  selected: readonly Topic[],
  publishable: readonly { id: string }[],
): Topic[] {
  const available = new Set(publishable.map(({ id }) => id));
  return selected.filter(({ id }) => !available.has(id));
}

/** The task detail may contain an older result shape; only render safe catalog labels. */
export function discoveryMissingTopicNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (topic): topic is Topic =>
        topic !== null &&
        typeof topic === 'object' &&
        typeof topic.id === 'string' &&
        /^topic-[a-z0-9-]+$/.test(topic.id) &&
        typeof topic.name === 'string' &&
        topic.name.trim().length > 0 &&
        topic.name.length <= 200,
    )
    .slice(0, 100)
    .map(({ name }) => name);
}
