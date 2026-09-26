import 'server-only';
import { getPublishedTopicInsights } from './automation-insights';
import { currentInsight } from '../topic-insight-core';
import type { SignalEntry } from '../public-signal-reader-core';

export async function visibleTopicInsights(signals: SignalEntry[]) {
  const rows = await getPublishedTopicInsights();
  return rows
    .flatMap((row) => {
      const result = currentInsight(row.result, signals);
      return result ? [{ id: row.id, result, published_at: row.published_at }] : [];
    })
    .sort(
      (a, b) =>
        b.result.generatedAt.localeCompare(a.result.generatedAt) || a.id.localeCompare(b.id),
    );
}
