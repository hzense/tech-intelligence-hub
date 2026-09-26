import { createHash } from 'node:crypto';
import type { SignalEntry } from './public-signal-reader-core.ts';

export interface InsightInput {
  id: string;
  version: number | null;
  revision: number | null;
  digest: string;
}
export interface InsightReport {
  title: string;
  summary: string;
  sections: { heading: string; body: string; signalIds: string[] }[];
  uncertainties: string[];
}
export interface TopicInsightResult {
  kind: 'topic_insight';
  topicIds: string[];
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  inputs: InsightInput[];
  report: InsightReport;
}
export function insightInput(entry: SignalEntry): InsightInput {
  return {
    id: entry.id,
    version: entry.public_version ?? null,
    revision: entry.publication_revision ?? null,
    digest: createHash('sha256')
      .update(
        JSON.stringify({
          id: entry.id,
          title: entry.title,
          summary: entry.summary,
          analysis: entry.analysis ?? '',
          occurred_at: entry.occurred_at,
          topics: entry.topics,
          people: entry.public_people ?? [],
          organizations: entry.public_organizations ?? [],
          sources: entry.public_sources ?? [],
        }),
      )
      .digest('hex'),
  };
}
export function selectInsightSignals(signals: SignalEntry[], topicIds: string[], end: Date) {
  const endMs = end.getTime();
  if (!Number.isFinite(endMs)) throw new Error('invalid_insight_window');
  const startMs = endMs - 30 * 86400000;
  const unique = new Map<string, SignalEntry>();
  for (const signal of signals) {
    const date = Date.parse(signal.occurred_at);
    if (
      !(signal.public_version || signal.publication_basis === 'manual_confirmation') ||
      date < startMs ||
      date > endMs ||
      !Number.isFinite(date) ||
      !signal.topics.some((id) => topicIds.includes(id))
    )
      continue;
    unique.set(signal.id, signal);
  }
  const selected = [...unique.values()].sort(
    (a, b) => b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id),
  );
  // Do not silently cut evidence to fit a model: an operator can narrow the topic scope.
  if (selected.length > 100) throw new Error('insight_input_too_large');
  return {
    signals: selected,
    windowStart: new Date(startMs).toISOString(),
    windowEnd: end.toISOString(),
  };
}
const stringSchema = { type: 'string' as const };
export const insightReportSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['title', 'summary', 'sections', 'uncertainties'],
  properties: {
    title: stringSchema,
    summary: stringSchema,
    sections: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['heading', 'body', 'signalIds'],
        properties: {
          heading: stringSchema,
          body: stringSchema,
          signalIds: { type: 'array' as const, items: stringSchema },
        },
      },
    },
    uncertainties: { type: 'array' as const, items: stringSchema },
  },
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_insight');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value].length > max ||
    /<\/?(?:think|analysis|reasoning)\b/i.test(value) ||
    [...value].some(
      (character) => character.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(character),
    )
  )
    throw new Error('invalid_insight');
  return value.trim();
}
export function validateInsightReport(value: unknown, inputIds: readonly string[]): InsightReport {
  const row = object(value);
  if (
    Object.keys(row).sort().join(',') !== 'sections,summary,title,uncertainties' ||
    !Array.isArray(row.sections) ||
    row.sections.length < 1 ||
    row.sections.length > 8 ||
    !Array.isArray(row.uncertainties) ||
    row.uncertainties.length < 1 ||
    row.uncertainties.length > 8
  )
    throw new Error('invalid_insight');
  return {
    title: text(row.title, 100),
    summary: text(row.summary, 800),
    sections: row.sections.map((value) => {
      const section = object(value);
      if (
        Object.keys(section).sort().join(',') !== 'body,heading,signalIds' ||
        !Array.isArray(section.signalIds) ||
        !section.signalIds.length ||
        section.signalIds.length > 100 ||
        section.signalIds.some((id) => typeof id !== 'string' || !inputIds.includes(id))
      )
        throw new Error('invalid_insight_citation');
      return {
        heading: text(section.heading, 100),
        body: text(section.body, 4000),
        signalIds: [...new Set(section.signalIds as string[])],
      };
    }),
    uncertainties: row.uncertainties.map((v) => text(v, 800)),
  };
}
/** Validate before rendering; stale/withdrawn dependencies never expose a stored report. */
export function currentInsight(value: unknown, current: SignalEntry[]): TopicInsightResult | null {
  try {
    const row = object(value);
    if (
      row.kind !== 'topic_insight' ||
      !Array.isArray(row.inputs) ||
      row.inputs.length < 2 ||
      row.inputs.length > 100 ||
      !Array.isArray(row.topicIds) ||
      !row.topicIds.length ||
      row.topicIds.length > 5 ||
      row.topicIds.some((id) => typeof id !== 'string' || !/^topic-[a-z0-9-]+$/.test(id))
    )
      return null;
    const map = new Map(
      current
        .filter((s) => s.public_version || s.publication_basis === 'manual_confirmation')
        .map((s) => [s.id, insightInput(s)]),
    );
    const inputs = row.inputs.map((value) => {
      const input = object(value);
      const now = map.get(String(input.id));
      if (
        !now ||
        now.digest !== input.digest ||
        now.version !== input.version ||
        now.revision !== input.revision
      )
        throw new Error('stale_insight');
      return now;
    });
    if (new Set(inputs.map((i) => i.id)).size !== inputs.length) return null;
    const dates = ['windowStart', 'windowEnd', 'generatedAt'].map((key) => text(row[key], 40));
    if (
      dates.some((date) => !Number.isFinite(Date.parse(date))) ||
      Date.parse(dates[0]!) >= Date.parse(dates[1]!)
    )
      return null;
    return {
      kind: 'topic_insight',
      topicIds: row.topicIds as string[],
      inputs,
      windowStart: dates[0]!,
      windowEnd: dates[1]!,
      generatedAt: dates[2]!,
      report: validateInsightReport(
        row.report,
        inputs.map((i) => i.id),
      ),
    };
  } catch {
    return null;
  }
}
