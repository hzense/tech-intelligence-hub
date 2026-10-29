import { createHash } from 'node:crypto';
import { isEditorialSignal, type SignalEntry } from './public-signal-reader-core.ts';

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
export const insightReportFields = [
  'report',
  'title',
  'summary',
  'sections',
  'sections.item',
  'sections.heading',
  'sections.body',
  'sections.signalIds',
  'uncertainties',
  'uncertainties.item',
] as const;
export const insightReportFailureReasons = [
  'wrong_type',
  'empty',
  'too_long',
  'invalid_count',
  'invalid_fields',
  'reasoning_markup',
  'control_character',
  'invalid_citation',
] as const;
export class InsightReportValidationError extends Error {
  readonly field: (typeof insightReportFields)[number];
  readonly reason: (typeof insightReportFailureReasons)[number];
  constructor(
    field: (typeof insightReportFields)[number],
    reason: (typeof insightReportFailureReasons)[number],
    code: 'invalid_insight' | 'invalid_insight_citation' = 'invalid_insight',
  ) {
    super(code);
    this.name = 'InsightReportValidationError';
    this.field = field;
    this.reason = reason;
  }
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
      !(signal.public_version || isEditorialSignal(signal)) ||
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
          heading: { ...stringSchema, description: '非空小标题，最多100字。' },
          body: stringSchema,
          signalIds: { type: 'array' as const, items: stringSchema },
        },
      },
    },
    uncertainties: {
      type: 'array' as const,
      description: '必须给出1至8项具体且有实质内容的不确定性；不得为空数组或用空字符串占位。',
      items: {
        ...stringSchema,
        description: '必须是非空的具体证据缺口、尚未确认的事实或结论成立条件，最多800字。',
      },
    },
  },
};
function object(
  value: unknown,
  field: (typeof insightReportFields)[number] = 'report',
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InsightReportValidationError(field, 'wrong_type');
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  max: number,
  field: (typeof insightReportFields)[number] = 'report',
): string {
  if (typeof value !== 'string') throw new InsightReportValidationError(field, 'wrong_type');
  if (!value.trim()) throw new InsightReportValidationError(field, 'empty');
  if ([...value].length > max) throw new InsightReportValidationError(field, 'too_long');
  if (/<\/?(?:think|analysis|reasoning)\b/i.test(value))
    throw new InsightReportValidationError(field, 'reasoning_markup');
  if (
    [...value].some(
      (character) => character.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(character),
    )
  )
    throw new InsightReportValidationError(field, 'control_character');
  return value.trim();
}
export function validateInsightReport(value: unknown, inputIds: readonly string[]): InsightReport {
  const row = object(value);
  if (Object.keys(row).sort().join(',') !== 'sections,summary,title,uncertainties')
    throw new InsightReportValidationError('report', 'invalid_fields');
  if (!Array.isArray(row.sections))
    throw new InsightReportValidationError('sections', 'wrong_type');
  if (row.sections.length < 1 || row.sections.length > 8)
    throw new InsightReportValidationError('sections', 'invalid_count');
  if (!Array.isArray(row.uncertainties))
    throw new InsightReportValidationError('uncertainties', 'wrong_type');
  if (row.uncertainties.length < 1 || row.uncertainties.length > 8)
    throw new InsightReportValidationError('uncertainties', 'invalid_count');
  return {
    title: text(row.title, 100, 'title'),
    summary: text(row.summary, 800, 'summary'),
    sections: row.sections.map((value) => {
      const section = object(value, 'sections.item');
      if (
        Object.keys(section).sort().join(',') !== 'body,heading,signalIds' ||
        !Array.isArray(section.signalIds) ||
        !section.signalIds.length ||
        section.signalIds.length > 100 ||
        section.signalIds.some((id) => typeof id !== 'string' || !inputIds.includes(id))
      )
        throw new InsightReportValidationError(
          'sections.signalIds',
          'invalid_citation',
          'invalid_insight_citation',
        );
      return {
        heading: text(section.heading, 100, 'sections.heading'),
        body: text(section.body, 4000, 'sections.body'),
        signalIds: [...new Set(section.signalIds as string[])],
      };
    }),
    uncertainties: row.uncertainties.map((v) => text(v, 800, 'uncertainties.item')),
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
        .filter((s) => s.public_version || isEditorialSignal(s))
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
