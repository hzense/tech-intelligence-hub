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
  // Current assessment metrics belong exclusively to Radar snapshots, not Topic Markdown.
  attention: z.never().optional(),
  trend: z.never().optional(),
  maturity: z.never().optional(),
  strategic_value: z.never().optional(),
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
  insightSchema,
  briefingSchema,
  topicSchema,
  paperNoteSchema,
]);
export type FrontMatter = z.infer<typeof frontMatterSchema>;
export const validateFrontMatter = (input: unknown): FrontMatter => frontMatterSchema.parse(input);
