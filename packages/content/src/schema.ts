import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
// YAML date-only values are normalized in UTC; callers should avoid local-time Date constructors.
const date = z.preprocess(
  (value) =>
    value instanceof Date && !Number.isNaN(value.valueOf())
      ? value.toISOString().slice(0, 10)
      : value,
  z.iso.date(),
);
const dateTime = z.iso.datetime({ offset: true });
const language = z.enum(['zh-CN', 'en']);
const contentStatus = z.enum(['draft', 'review', 'published', 'archived']);
const topicStatus = z.enum(['watching', 'active', 'strategic', 'archived']);
const importance = z.number().int().min(1).max(5);
const topicIds = z.array(id).default([]);
const entityIds = z.array(id).default([]);

const common = z.object({
  id,
  title: z.string().min(1),
  language: language.optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const dailySchema = common.extend({
  type: z.literal('daily'),
  status: contentStatus,
  edition: z.enum(['historical_example', 'live']),
  date,
  language,
  summary: z.string().trim().min(1),
  signal_count: z.number().int().positive(),
  major_developments: z.number().int().positive(),
  rising_topics: z.array(id).min(1),
  signal_refs: z.array(id).min(1),
  importance: importance.optional(),
  timezone: z.literal('Europe/Berlin').optional(),
  window_start_at: dateTime.optional(),
  cutoff_at: dateTime.optional(),
  generator_version: z.literal('daily-v1').optional(),
  input_fingerprint: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
});
export const weeklySchema = common.extend({
  type: z.literal('weekly'),
  status: contentStatus,
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  start_date: date,
  end_date: date,
  signal_count: z.number().int().nonnegative(),
  daily_refs: z.array(id).default([]),
  featured_topics: topicIds,
  importance: importance.optional(),
});
export const insightSchema = common.extend({
  type: z.literal('insight'),
  status: contentStatus,
  date,
  importance,
  topics: topicIds,
  companies: entityIds.optional(),
  technologies: entityIds.optional(),
  evidence_signals: z.array(id).default([]),
  counter_signals: z.array(id).optional(),
});
export const briefingSchema = common.extend({
  type: z.literal('briefing'),
  status: contentStatus,
  date,
  topics: topicIds,
  technologies: entityIds.optional(),
  importance: importance.optional(),
});
export const topicSchema = common.extend({
  type: z.literal('topic'),
  status: topicStatus,
  parent: id.nullable().optional(),
  attention: z.number().int().min(0).max(100).optional(),
  trend: z.enum(['rapid_growth', 'growth', 'stable', 'decline', 'rapid_decline']).optional(),
  maturity: z.enum(['research', 'early', 'emerging', 'growth', 'mature']).optional(),
  strategic_value: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});
export const paperNoteSchema = common.extend({
  type: z.literal('paper_note'),
  status: contentStatus,
  date,
  paper: id,
  topics: topicIds,
  importance: importance.optional(),
  related_entities: entityIds.optional(),
});

export const frontMatterSchema = z.discriminatedUnion('type', [
  dailySchema,
  weeklySchema,
  insightSchema,
  briefingSchema,
  topicSchema,
  paperNoteSchema,
]);
export type FrontMatter = z.infer<typeof frontMatterSchema>;
export const validateFrontMatter = (input: unknown): FrontMatter => frontMatterSchema.parse(input);
