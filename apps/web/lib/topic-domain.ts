/** Resolve taxonomy descendants to their top-level domains, keeping each domain once per signal. */
export function createTopicDomainResolver(
  topics: readonly { id: string; parentId: string | null }[],
) {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const roots = new Map<string, string>();
  for (const { id } of topics) {
    const visited = new Set<string>();
    let topic = byId.get(id);
    while (topic && topic.parentId !== null && !visited.has(topic.id)) {
      visited.add(topic.id);
      topic = byId.get(topic.parentId);
    }
    if (topic?.parentId === null) roots.set(id, topic.id);
  }
  return (topicIds: readonly string[]): string[] => {
    const domainIds = new Set<string>();
    for (const id of topicIds) {
      const domainId = roots.get(id);
      if (domainId) domainIds.add(domainId);
    }
    return [...domainIds];
  };
}
