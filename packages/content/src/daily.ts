import { createHash } from 'node:crypto';
import type { ContentEntry } from './loader.js';
import type { SeedCatalog, SeedSignal, SeedTopic } from './seed.js';

export const DAILY_POLICY_VERSION = 'daily-v1' as const;
export const DAILY_TIMEZONE = 'Europe/Berlin' as const;

export interface DailyDraftRequest {
  cutoffAt: string;
  date: string;
  maxPerTopic: number;
  maxSignals: number;
  minImportance: number;
  policyVersion: typeof DAILY_POLICY_VERSION;
  timezone: typeof DAILY_TIMEZONE;
  windowStartAt: string;
}

export interface DailySelection {
  diagnostics: {
    duplicateSignalIds: string[];
    eligibleSignals: number;
  };
  primaryTopicBySignal: Map<string, SeedTopic>;
  request: DailyDraftRequest;
  signals: SeedSignal[];
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const livePathPattern = /^daily\/(\d{4})\/(\d{4}-\d{2}-\d{2})\.md$/;
const candidateMarkerPattern =
  /HZENSE_DAILY_CANDIDATE|待人工研判|发布前必须由人工|human review required/i;

function assertCalendarDate(date: string): void {
  if (
    !datePattern.test(date) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid Daily date: ${date}`);
  }
}

function offsetMinutesAt(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(instant);
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset ?? '');
  if (!match) throw new Error(`Cannot resolve UTC offset for ${timezone}`);
  const [, sign, hours = '0', minutes = '0'] = match;
  const absolute = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -absolute : absolute;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function previousDate(date: string): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() - 1);
  return instant.toISOString().slice(0, 10);
}

function localTime(date: string, hour: number, timezone: string): string {
  const nominal = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  let offset = offsetMinutesAt(new Date(nominal), timezone);
  let instant = nominal - offset * 60_000;
  const correctedOffset = offsetMinutesAt(new Date(instant), timezone);
  if (correctedOffset !== offset) {
    offset = correctedOffset;
    instant = nominal - offset * 60_000;
  }
  const resolvedDate = dateInTimezone(new Date(instant).toISOString(), timezone);
  if (resolvedDate !== date) throw new Error(`Cannot resolve ${date} in ${timezone}`);
  return `${date}T${String(hour).padStart(2, '0')}:00:00${formatOffset(offset)}`;
}

function dateInTimezone(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).formatToParts(new Date(value));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

export function buildDailyDraftRequest(date: string): DailyDraftRequest {
  assertCalendarDate(date);
  return {
    cutoffAt: localTime(date, 7, DAILY_TIMEZONE),
    date,
    maxPerTopic: 2,
    maxSignals: 5,
    minImportance: 3,
    policyVersion: DAILY_POLICY_VERSION,
    timezone: DAILY_TIMEZONE,
    windowStartAt: localTime(previousDate(date), 7, DAILY_TIMEZONE),
  };
}

export function validateDailyDraftRequest(request: DailyDraftRequest): void {
  assertCalendarDate(request.date);
  if (request.policyVersion !== DAILY_POLICY_VERSION) throw new Error('Unsupported Daily policy');
  if (request.timezone !== DAILY_TIMEZONE) throw new Error('Unsupported Daily timezone');
  if (!Number.isInteger(request.maxSignals) || request.maxSignals < 1)
    throw new Error('maxSignals must be a positive integer');
  if (!Number.isInteger(request.maxPerTopic) || request.maxPerTopic < 1)
    throw new Error('maxPerTopic must be a positive integer');
  if (
    !Number.isInteger(request.minImportance) ||
    request.minImportance < 1 ||
    request.minImportance > 5
  ) {
    throw new Error('minImportance must be between 1 and 5');
  }

  const windowStart = Date.parse(request.windowStartAt);
  const cutoff = Date.parse(request.cutoffAt);
  if (!Number.isFinite(windowStart) || !Number.isFinite(cutoff) || windowStart >= cutoff) {
    throw new Error('Daily window must contain valid, increasing RFC3339 timestamps');
  }
  if (dateInTimezone(request.cutoffAt, request.timezone) !== request.date) {
    throw new Error('Daily cutoff must fall on the Daily date in Europe/Berlin');
  }
}

function normalizedSourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

function compareSignals(left: SeedSignal, right: SeedSignal): number {
  const statusDifference = Number(right.status === 'accepted') - Number(left.status === 'accepted');
  return (
    statusDifference ||
    right.importance - left.importance ||
    right.strength - left.strength ||
    right.confidence - left.confidence ||
    right.novelty - left.novelty ||
    Date.parse(right.occurred_at) - Date.parse(left.occurred_at) ||
    Date.parse(right.captured_at) - Date.parse(left.captured_at) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

export function selectDailyCandidates(
  catalog: SeedCatalog,
  request: DailyDraftRequest,
  usedSignalIds: ReadonlySet<string> = new Set(),
): DailySelection {
  validateDailyDraftRequest(request);
  const sourceById = new Map(catalog.sources.map((source) => [source.id, source]));
  const topicById = new Map(catalog.topics.map((topic) => [topic.id, topic]));
  const primaryTopicBySignal = new Map<string, SeedTopic>();
  const windowStart = Date.parse(request.windowStartAt);
  const cutoff = Date.parse(request.cutoffAt);

  const eligible = catalog.signals
    .filter((signal) => {
      if (usedSignalIds.has(signal.id)) return false;
      if (signal.status !== 'accepted' && signal.status !== 'reviewed') return false;
      if (signal.importance < request.minImportance) return false;
      if (Date.parse(signal.captured_at) <= windowStart || Date.parse(signal.captured_at) > cutoff)
        return false;
      if (Date.parse(signal.occurred_at) > cutoff) return false;
      if (!sourceById.get(signal.source_id)?.active) return false;
      const primaryTopic = signal.topics
        .map((topicId) => topicById.get(topicId))
        .find((topic): topic is SeedTopic => Boolean(topic && topic.status !== 'archived'));
      if (!primaryTopic) return false;
      primaryTopicBySignal.set(signal.id, primaryTopic);
      return true;
    })
    .sort(compareSignals);

  const duplicateSignalIds: string[] = [];
  const deduplicated: SeedSignal[] = [];
  const seenEvents = new Set<string>();
  for (const signal of eligible) {
    const eventKey = signal.event_key
      ? `event:${signal.event_key}`
      : `url:${normalizedSourceUrl(signal.source_url)}`;
    if (seenEvents.has(eventKey)) {
      duplicateSignalIds.push(signal.id);
      continue;
    }
    seenEvents.add(eventKey);
    deduplicated.push(signal);
  }

  const bestByTopic = new Map<string, SeedSignal>();
  for (const signal of deduplicated) {
    const topic = primaryTopicBySignal.get(signal.id);
    if (topic && !bestByTopic.has(topic.id)) bestByTopic.set(topic.id, signal);
  }

  const selected: SeedSignal[] = [];
  const selectedIds = new Set<string>();
  const countByTopic = new Map<string, number>();
  const add = (signal: SeedSignal) => {
    const topicId = primaryTopicBySignal.get(signal.id)?.id;
    if (!topicId || selectedIds.has(signal.id)) return;
    if ((countByTopic.get(topicId) ?? 0) >= request.maxPerTopic) return;
    selected.push(signal);
    selectedIds.add(signal.id);
    countByTopic.set(topicId, (countByTopic.get(topicId) ?? 0) + 1);
  };

  for (const signal of [...bestByTopic.values()].sort(compareSignals)) {
    if (selected.length >= request.maxSignals) break;
    add(signal);
  }
  for (const signal of deduplicated) {
    if (selected.length >= request.maxSignals) break;
    add(signal);
  }
  selected.sort(compareSignals);

  return {
    diagnostics: { duplicateSignalIds, eligibleSignals: eligible.length },
    primaryTopicBySignal,
    request,
    signals: selected,
  };
}

function yamlList(values: string[]): string {
  return values.map((value) => `  - ${value}`).join('\n');
}

function yamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function dailyInputFingerprint(selection: DailySelection): string {
  const input = {
    request: selection.request,
    signals: selection.signals.map((signal) => ({
      captured_at: signal.captured_at,
      confidence: signal.confidence,
      event_key: signal.event_key ?? null,
      id: signal.id,
      importance: signal.importance,
      novelty: signal.novelty,
      occurred_at: signal.occurred_at,
      primary_topic: (() => {
        const topic = selection.primaryTopicBySignal.get(signal.id);
        return topic ? { id: topic.id, status: topic.status, title: topic.title } : null;
      })(),
      source_id: signal.source_id,
      source_url: normalizedSourceUrl(signal.source_url),
      status: signal.status,
      strength: signal.strength,
      summary: signal.summary,
      title: signal.title,
      topics: signal.topics,
      type: signal.type,
    })),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
}

export function renderDailyDraft(selection: DailySelection): string {
  if (selection.signals.length === 0) throw new Error('Cannot render an empty Daily candidate');
  const topicIds = [
    ...new Set(
      selection.signals.flatMap((signal) => {
        const topic = selection.primaryTopicBySignal.get(signal.id);
        return topic ? [topic.id] : [];
      }),
    ),
  ];
  const topicTitleById = new Map(
    [...selection.primaryTopicBySignal.values()].map((topic) => [topic.id, topic.title]),
  );
  const topicTitles = topicIds.map((id) => topicTitleById.get(id) ?? id);
  const signalIds = selection.signals.map((signal) => signal.id);
  const importance = Math.max(...selection.signals.map((signal) => signal.importance));
  const fingerprint = dailyInputFingerprint(selection);
  const summary = `本期自动汇集 ${selection.signals.length} 条已审核科技信号，涵盖 ${topicTitles.join('、')}；发布前必须由人工核验事实、取舍与研判。`;

  const sections = selection.signals.map((signal) => {
    const topic = selection.primaryTopicBySignal.get(signal.id);
    if (!topic) throw new Error(`Missing primary topic for ${signal.id}`);
    return `## ${topic.title}｜${signal.title}\n\n${signal.summary}\n\n为什么重要：待人工研判。\n\n证据：[查看 Signal](/signals/${signal.id}) · [原始来源](${normalizedSourceUrl(signal.source_url)})`;
  });

  return `---
id: daily-${selection.request.date}
title: HZense Daily — ${selection.request.date}
type: daily
status: draft
edition: live
date: ${selection.request.date}
language: zh-CN
timezone: ${selection.request.timezone}
window_start_at: ${yamlString(selection.request.windowStartAt)}
cutoff_at: ${yamlString(selection.request.cutoffAt)}
generator_version: ${selection.request.policyVersion}
input_fingerprint: ${fingerprint}
summary: ${yamlString(summary)}
signal_count: ${selection.signals.length}
major_developments: ${selection.signals.length}
rising_topics:
${yamlList(topicIds)}
signal_refs:
${yamlList(signalIds)}
importance: ${importance}
---

# HZense Daily — ${selection.request.date}

<!-- HZENSE_DAILY_CANDIDATE: human review required before publication -->

## 执行摘要

${summary}

${sections.join('\n\n')}
`;
}

function uniqueDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

export function validateDailyIntegrity(entries: ContentEntry[], catalog: SeedCatalog): void {
  const issues: string[] = [];
  const signalById = new Map(catalog.signals.map((signal) => [signal.id, signal]));
  const sourceById = new Map(catalog.sources.map((source) => [source.id, source]));
  const topicById = new Map(catalog.topics.map((topic) => [topic.id, topic]));
  const dailyByDate = new Map<string, ContentEntry>();
  const dailyBySignalId = new Map<string, ContentEntry>();

  for (const entry of entries) {
    if (entry.frontMatter.type !== 'daily') continue;
    const daily = entry.frontMatter;
    const previous = dailyByDate.get(daily.date);
    if (previous)
      issues.push(
        `${entry.relativePath}: duplicate Daily date ${daily.date} (also ${previous.relativePath})`,
      );
    else dailyByDate.set(daily.date, entry);

    if (daily.id !== `daily-${daily.date}`)
      issues.push(`${entry.relativePath}: id must be daily-${daily.date}`);
    const pathMatch = livePathPattern.exec(entry.relativePath);
    if (!pathMatch || pathMatch[1] !== daily.date.slice(0, 4) || pathMatch[2] !== daily.date) {
      issues.push(
        `${entry.relativePath}: path must be daily/${daily.date.slice(0, 4)}/${daily.date}.md`,
      );
    }

    const duplicateSignals = uniqueDuplicates(daily.signal_refs);
    if (duplicateSignals.length > 0)
      issues.push(`${entry.relativePath}: duplicate signal_refs ${duplicateSignals.join(', ')}`);
    const duplicateTopics = uniqueDuplicates(daily.rising_topics);
    if (duplicateTopics.length > 0)
      issues.push(`${entry.relativePath}: duplicate rising_topics ${duplicateTopics.join(', ')}`);
    if (daily.signal_count !== daily.signal_refs.length) {
      issues.push(
        `${entry.relativePath}: signal_count ${daily.signal_count} does not match ${daily.signal_refs.length} signal_refs`,
      );
    }
    for (const signalId of daily.signal_refs) {
      const previousSignalOwner = dailyBySignalId.get(signalId);
      if (previousSignalOwner) {
        issues.push(
          `${entry.relativePath}: Signal ${signalId} is already used by ${previousSignalOwner.relativePath}`,
        );
      } else {
        dailyBySignalId.set(signalId, entry);
      }
    }

    const developmentSections = entry.sections.filter(
      (section) => section.level === 2 && section.heading !== '执行摘要',
    );
    if (daily.major_developments !== developmentSections.length) {
      issues.push(
        `${entry.relativePath}: major_developments ${daily.major_developments} does not match ${developmentSections.length} sections`,
      );
    }
    const executiveSummaries = entry.sections.filter(
      (section) => section.level === 2 && section.heading === '执行摘要',
    );
    if (executiveSummaries.length !== 1 || executiveSummaries[0]?.paragraphs.length === 0) {
      issues.push(`${entry.relativePath}: requires one non-empty 执行摘要 section`);
    }
    if (!entry.body.trim() || !daily.summary.trim())
      issues.push(`${entry.relativePath}: Daily summary and body must be non-empty`);

    let expectedSelection: DailySelection | undefined;
    if (daily.edition === 'live') {
      if (daily.signal_count > 5)
        issues.push(`${entry.relativePath}: live Daily exceeds 5 Signals`);
      if (
        !daily.window_start_at ||
        !daily.cutoff_at ||
        !daily.timezone ||
        !daily.generator_version ||
        !daily.input_fingerprint
      ) {
        issues.push(`${entry.relativePath}: live Daily requires generation provenance fields`);
      } else {
        try {
          const expectedRequest = buildDailyDraftRequest(daily.date);
          if (
            daily.window_start_at !== expectedRequest.windowStartAt ||
            daily.cutoff_at !== expectedRequest.cutoffAt ||
            daily.timezone !== expectedRequest.timezone ||
            daily.generator_version !== expectedRequest.policyVersion
          ) {
            issues.push(`${entry.relativePath}: live generation window must match daily-v1`);
          }
          const usedSignalIds = new Set(
            entries.flatMap((other) =>
              other !== entry && other.frontMatter.type === 'daily'
                ? other.frontMatter.signal_refs
                : [],
            ),
          );
          expectedSelection = selectDailyCandidates(catalog, expectedRequest, usedSignalIds);
          const expectedSignalIds = expectedSelection.signals.map((signal) => signal.id);
          if (expectedSignalIds.join('\0') !== daily.signal_refs.join('\0')) {
            issues.push(
              `${entry.relativePath}: signal_refs must match daily-v1 selection in order (expected ${expectedSignalIds.join(', ') || 'none'})`,
            );
          }
        } catch (error) {
          issues.push(
            `${entry.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    const livePrimaryTopics: string[] = [];
    const liveTopicCounts = new Map<string, number>();
    for (const signalId of daily.signal_refs) {
      const signal = signalById.get(signalId);
      if (!signal) continue;
      if (
        daily.status !== 'archived' &&
        signal.status !== 'accepted' &&
        signal.status !== 'reviewed'
      ) {
        issues.push(`${entry.relativePath}: ineligible Signal ${signalId}`);
      }
      if (!sourceById.get(signal.source_id)?.active)
        issues.push(`${entry.relativePath}: inactive source for ${signalId}`);
      if (new Date(signal.occurred_at).toISOString().slice(0, 10) > daily.date) {
        issues.push(`${entry.relativePath}: future Signal occurrence ${signalId}`);
      }
      if (daily.edition === 'live' && daily.window_start_at && daily.cutoff_at) {
        if (signal.importance < 3) {
          issues.push(
            `${entry.relativePath}: Signal ${signalId} is below the live importance floor`,
          );
        }
        const primaryTopic = signal.topics.find(
          (topicId) => topicById.get(topicId)?.status !== 'archived',
        );
        if (primaryTopic) {
          if (!livePrimaryTopics.includes(primaryTopic)) livePrimaryTopics.push(primaryTopic);
          liveTopicCounts.set(primaryTopic, (liveTopicCounts.get(primaryTopic) ?? 0) + 1);
        }
        const captured = Date.parse(signal.captured_at);
        if (
          captured <= Date.parse(daily.window_start_at) ||
          captured > Date.parse(daily.cutoff_at)
        ) {
          issues.push(`${entry.relativePath}: Signal ${signalId} falls outside the capture window`);
        }
        if (Date.parse(signal.occurred_at) > Date.parse(daily.cutoff_at)) {
          issues.push(`${entry.relativePath}: Signal ${signalId} occurred after cutoff`);
        }
      }
    }

    if (daily.edition === 'live') {
      if (livePrimaryTopics.join('\0') !== daily.rising_topics.join('\0')) {
        issues.push(`${entry.relativePath}: rising_topics must match live primary Topics in order`);
      }
      for (const [topicId, count] of liveTopicCounts) {
        if (count > 2)
          issues.push(`${entry.relativePath}: live Topic ${topicId} exceeds 2 Signals`);
      }
      if (daily.input_fingerprint && expectedSelection) {
        const expectedFingerprint = dailyInputFingerprint(expectedSelection);
        if (daily.input_fingerprint !== expectedFingerprint) {
          issues.push(`${entry.relativePath}: input_fingerprint does not match Daily inputs`);
        }
      }
    }

    for (const topicId of daily.rising_topics) {
      if (topicById.get(topicId)?.status === 'archived')
        issues.push(`${entry.relativePath}: archived rising Topic ${topicId}`);
      const supported = daily.signal_refs.some((signalId) =>
        signalById.get(signalId)?.topics.includes(topicId),
      );
      if (!supported)
        issues.push(`${entry.relativePath}: rising Topic ${topicId} has no supporting Signal`);
    }
    if (
      daily.status === 'published' &&
      candidateMarkerPattern.test(`${daily.summary}\n${entry.body}`)
    ) {
      issues.push(`${entry.relativePath}: published Daily contains an automation review marker`);
    }
  }

  if (issues.length > 0)
    throw new Error(
      `Daily integrity validation failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
}

export function assertDailyPublicationReady(entries: ContentEntry[]): void {
  const unpublished = entries.filter(
    (entry) =>
      entry.frontMatter.type === 'daily' &&
      !['published', 'archived'].includes(entry.frontMatter.status),
  );
  if (unpublished.length > 0) {
    throw new Error(
      `Daily publication gate failed:\n${unpublished.map((entry) => `- ${entry.relativePath}: status is ${entry.frontMatter.status}`).join('\n')}`,
    );
  }
}
