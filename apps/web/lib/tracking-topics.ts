/** Shared by the public directory and server-side insight admission. */
export const trackingSignalMinimum = 10;

type TopicSignal = { id: string; topics: readonly string[] };

export function countTopicSignals(signals: readonly TopicSignal[]): Map<string, number> {
  const idsByTopic = new Map<string, Set<string>>();
  for (const signal of signals) {
    for (const topic of signal.topics) {
      const ids = idsByTopic.get(topic) ?? new Set<string>();
      ids.add(signal.id);
      idsByTopic.set(topic, ids);
    }
  }
  return new Map([...idsByTopic].map(([id, signals]) => [id, signals.size]));
}

export function trackedTopicIds(
  nonRootLeafIds: ReadonlySet<string>,
  signals: readonly TopicSignal[],
): Set<string> {
  return new Set(
    [...countTopicSignals(signals)]
      .filter(([id, count]) => nonRootLeafIds.has(id) && count >= trackingSignalMinimum)
      .map(([id]) => id),
  );
}
