import {
  isSignalEventType,
  SIGNAL_EVENT_TYPE_LABELS,
  type SignalEventType,
} from '@hzense/ingestion/signal-types';
import reviewedClassifications from '../../../data/seed/signal-event-classifications.json' with { type: 'json' };

const reviewed = new Map(reviewedClassifications.map((row) => [row.id, row]));
export const signalEventTypeSearchLabels = Object.fromEntries(
  Object.entries(SIGNAL_EVENT_TYPE_LABELS).map(([type, label]) => [type, `${type} ${label}`]),
);
// The SQL query selects candidates before title/summary-bound classification.
// Retired storage types must admit their possible reviewed event labels here;
// search ranking below still applies the exact per-record rule, never this union.
export const signalEventTypeSearchPrefilter = { ...signalEventTypeSearchLabels };
for (const row of reviewedClassifications) {
  if (!isSignalEventType(row.type)) continue;
  const label = signalEventTypeSearchLabels[row.type]!;
  const current = signalEventTypeSearchPrefilter[row.previousType] ?? '';
  if (!current.includes(label)) {
    signalEventTypeSearchPrefilter[row.previousType] = `${current} ${label}`.trim();
  }
}

/** Presentation only: immutable archive content and publication receipts retain their original type. */
export function resolveSignalEventType(signal: {
  id: string;
  type: string;
  title: string;
  summary: string;
}): SignalEventType | null {
  if (isSignalEventType(signal.type)) return signal.type;
  const row = reviewed.get(signal.id);
  return row &&
    row.previousType === signal.type &&
    row.title === signal.title &&
    row.summary === signal.summary &&
    isSignalEventType(row.type)
    ? row.type
    : null;
}

export function signalEventTypeKeywords(
  signal: Parameters<typeof resolveSignalEventType>[0],
): string {
  const type = resolveSignalEventType(signal);
  return type ? signalEventTypeSearchLabels[type]! : '';
}
