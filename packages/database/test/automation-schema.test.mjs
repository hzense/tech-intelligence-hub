import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  automationColumns,
  automationChecks,
  automationForeignKeys,
  automationIndexes,
  automationUniqueIndexes,
  canonicalPublishedTopicInsightView,
  publishedTopicInsightViewExpressions,
} from '../src/automation-catalog.mjs';
import { automationRoleColumns, automationUpdateColumns } from '../src/automation-role.mjs';

const migration = () =>
  readFile(new URL('../../../db/migrations/0026_automation_tasks.sql', import.meta.url), 'utf8');
const roleSql = () =>
  readFile(new URL('../../../db/roles/configure_automation_roles.sql', import.meta.url), 'utf8');

describe('automation migration and role contract', () => {
  it('pins the reviewed migration and catalogs the exact private table shape', async () => {
    const [sql, manifest] = await Promise.all([
      migration(),
      readFile(new URL('../../../db/migrations/checksums.json', import.meta.url), 'utf8'),
    ]);
    expect(JSON.parse(manifest)['0026_automation_tasks.sql']).toBe(
      createHash('sha256').update(sql).digest('hex'),
    );
    expect(Object.keys(automationColumns)).toEqual(['automation_configs', 'automation_runs']);
    for (const [table, columns] of Object.entries(automationColumns)) {
      expect(sql).toContain(`CREATE TABLE public.${table}`);
      expect(Object.keys(columns)).toEqual([
        ...automationRoleColumns[table],
        ...(table === 'automation_configs' ? ['deleted_at'] : []),
      ]);
    }
    expect(automationForeignKeys).toEqual([
      'automation_runs|config_id,owner_id|automation_configs|id,owner_id|a|a|false',
    ]);
    expect(automationUniqueIndexes).toContain('automation_runs|config_id,slot');
    expect(automationIndexes).toContain('automation_runs|budget_day');
    expect(automationChecks.automation_runs).toHaveLength(14);
  });

  it('rejects a widened published view contract and never exposes private task rows', async () => {
    const sql = await migration();
    expect(sql).toContain(
      'CREATE VIEW public.published_topic_insights WITH(security_barrier=true)',
    );
    expect(sql).toContain(
      "WHERE status='completed' AND publication_status='published' AND snapshot->>'kind'='topic_insight'",
    );
    expect(
      publishedTopicInsightViewExpressions.has(
        canonicalPublishedTopicInsightView(
          "SELECT id, result, published_at FROM automation_runs WHERE (status = 'completed'::text) AND (publication_status = 'published'::text) AND ((snapshot ->> 'kind'::text) = 'topic_insight'::text);",
        ),
      ),
    ).toBe(true);
    expect(
      publishedTopicInsightViewExpressions.has(
        canonicalPublishedTopicInsightView(
          "SELECT id,result,published_at FROM automation_runs WHERE status='completed' OR publication_status='published'",
        ),
      ),
    ).toBe(false);
  });

  it('matches each direct role capability to the reviewed SQL grant and omits DELETE', async () => {
    const sql = (await roleSql()).replace(/\s+/g, ' ');
    expect(sql).not.toMatch(/\bGRANT\s+(?:ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/i);
    for (const [table, columns] of Object.entries(automationRoleColumns)) {
      const grants = sql.match(
        new RegExp(
          `GRANT SELECT \\(([^)]+)\\), INSERT \\(([^)]+)\\), UPDATE \\(([^)]+)\\) ON public\\.${table} TO hzense_automation_admin;`,
        ),
      );
      expect(grants, table).not.toBeNull();
      const list = (value) => value.split(',').map((part) => part.trim());
      expect(list(grants[1]), `${table} SELECT`).toEqual(columns);
      expect(list(grants[2]), `${table} INSERT`).toEqual(columns);
      expect(list(grants[3]), `${table} UPDATE`).toEqual(automationUpdateColumns[table]);
    }
    expect(sql).toContain(
      'GRANT SELECT (id,result,published_at) ON public.published_topic_insights TO hzense_insight_reader;',
    );
    expect(sql).not.toMatch(/ON public\.automation_(?:configs|runs) TO hzense_insight_reader/);
  });
});
