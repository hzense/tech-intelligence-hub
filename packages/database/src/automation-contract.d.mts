export interface AutomationConfig {
  name: string;
  kind: 'source_collection' | 'topic_insight';
  enabled: boolean;
  frequency: 'manual' | 'daily' | 'weekly';
  sourceUrls: string[];
  topicIds: string[];
  profileId: string | null;
  profileRevision: number | null;
  discovery?: { keywords: string[]; lookbackDays: number; maxSources: number };
}
export class AutomationError extends Error {
  code: string;
  constructor(code?: string);
}
export function normalizeAutomationConfig(value: unknown): AutomationConfig;
export function automationStableId(value: unknown): string;
export function automationUuid(value: unknown): string;
export function automationText(value: unknown, max?: number): string;
export function automationSlot(frequency: 'daily' | 'weekly', now: Date | string): string;
export function nextAutomationTime(
  frequency: 'manual' | 'daily' | 'weekly',
  now: Date | string,
): string | null;
