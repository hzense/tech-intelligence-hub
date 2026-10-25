import { discoverySearchLimit, discoveryUrl } from './source-discovery-core.ts';

// Search hits are a candidate pool, distinct from the eight selected originals.
export const discoverySearchResultLimit = 24;
export const discoveryInputTokens = 120000;
export const discoveryRequestByteLimit = 16000;
const exclusionUrlLimit = 40;
const exclusionByteLimit = 4096;

type Topic = { id: string; name: string };

/** Distribute the complete scope across the existing search allowance. Rotate
 * priorities by UTC date and model; this is a plan, not proof of executed searches. */
export function createDiscoverySearchPlan(
  topics: readonly Topic[],
  now: Date | string,
  modelId: string,
): { topics: Topic[] }[] {
  const day = new Date(now).toISOString().slice(0, 10);
  const unique = [...new Map(topics.map((topic) => [topic.id, topic])).values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  if (!unique.length) return [];
  let hash = 0;
  for (const character of `${day}:${modelId}`) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const offset = hash % unique.length;
  const ordered = [...unique.slice(offset), ...unique.slice(0, offset)];
  const groups = Array.from({ length: Math.min(discoverySearchLimit, ordered.length) }, () => ({
    topics: [] as Topic[],
  }));
  ordered.forEach((topic, index) => groups[index % groups.length]!.topics.push({ ...topic }));
  return groups;
}

/** Hints may disclose only already-public article URLs. Private collection
 * history stays in the local dedup set. Drop query/fragment-bearing URLs entirely,
 * rather than expose tokens or present a shortened URL as authoritative identity. */
export function publicDiscoveryExclusions(urls: readonly string[]): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  let bytes = 2; // JSON array brackets.
  for (const value of urls) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      continue;
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      continue;
    const url = discoveryUrl(value);
    if (!url || seen.has(url)) continue;
    const addedBytes = Buffer.byteLength(JSON.stringify(url), 'utf8') + (selected.length ? 1 : 0);
    if (bytes + addedBytes > exclusionByteLimit) continue;
    selected.push(url);
    seen.add(url);
    bytes += addedBytes;
    if (selected.length === exclusionUrlLimit) break;
  }
  return selected;
}
