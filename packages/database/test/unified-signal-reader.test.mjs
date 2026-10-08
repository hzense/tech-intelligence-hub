import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { unifiedBackfillFixture } from './fixtures/unified-signal-backfill.mjs';
import { previewUnifiedPublicSignals } from '../src/unified-signal-plan.mjs';
import {
  mapUnifiedSignalRows,
  createUnifiedSignalReader,
} from '../../../apps/web/lib/unified-signal-reader-core.ts';
import { mapEditorialSignalRows } from '../../../apps/web/lib/editorial-signal-reader-core.ts';
import { toUnifiedSignal } from '../../../apps/web/lib/unified-signal-core.ts';
import { unifiedSignalEnabled } from '../../../apps/web/lib/unified-signal-mode.ts';
import { projectEditorialEntityLinks } from '../../../apps/web/lib/editorial-entity-links.ts';

const fixture = await unifiedBackfillFixture();
const visible = previewUnifiedPublicSignals(fixture.plan, fixture.sources);
const rows = visible.map(({ id, ...row }) => ({
  signal_id: id,
  ...row,
  recorded_at: fixture.plan.signal_versions.find(
    (v) => v.signal_id === id && v.version === row.version,
  ).recorded_at,
}));
const mapped = mapUnifiedSignalRows(rows);

test('all 110 archived public contracts preserve text, event dates, sources, labels and resource links', () => {
  for (const row of fixture.sources.archivePlan.rows.filter((r) => r.projection !== null)) {
    assert.deepEqual(
      toUnifiedSignal(mapped.find((s) => s.id === row.signal_id)),
      toUnifiedSignal(row.projection),
    );
  }
});
test('editorial public contracts preserve identity, publication revision and unknown assessments', () => {
  for (const row of rows.filter((r) => r.origin === 'ai_generation')) {
    const revision = fixture.sources.editorialRevisions.find(
      (r) => r.candidate_index === 0 && r.revision === 1,
    );
    const old = mapEditorialSignalRows([
      {
        signal_id: row.signal_id,
        revision: row.version,
        content: revision.content,
        published_at: row.recorded_at,
      },
    ])[0];
    assert.deepEqual(
      toUnifiedSignal(mapped.find((s) => s.id === row.signal_id)),
      toUnifiedSignal(old),
    );
  }
  assert.equal(mapped.length, 112);
  assert.equal(new Set(mapped.map((r) => r.id)).size, 112);
});
test('name-only editorial versions retain catalog links after unified projection without changing storage', () => {
  const row = rows.find((r) => r.origin === 'ai_generation');
  const revision = fixture.sources.editorialRevisions.find(
    (r) => r.candidate_index === 0 && r.revision === 1,
  );
  const catalog = [
    { id: 'person-researcher', name: '测试研究员', type: 'person', status: 'active' },
    { id: 'company-lab', name: '测试研究组织', type: 'company', status: 'active' },
  ];
  const original = globalThis.structuredClone(row);
  const old = mapEditorialSignalRows([
    {
      signal_id: row.signal_id,
      revision: row.version,
      content: revision.content,
      published_at: row.recorded_at,
    },
  ]);
  const current = mapUnifiedSignalRows([row]);
  assert.equal(
    current[0].public_resources,
    undefined,
    'name-only rows must not claim reviewed identities',
  );
  assert.deepEqual(
    projectEditorialEntityLinks(current, catalog).map(toUnifiedSignal),
    projectEditorialEntityLinks(old, catalog).map(toUnifiedSignal),
  );
  assert.deepEqual(projectEditorialEntityLinks(current, catalog)[0].entities, [
    'person-researcher',
    'company-lab',
  ]);
  const ambiguous = [...catalog, { ...catalog[0], id: 'person-other' }];
  assert.equal(
    toUnifiedSignal(projectEditorialEntityLinks(current, ambiguous)[0]).people[0].id,
    null,
  );
  assert.deepEqual(projectEditorialEntityLinks(current, [])[0].entities, []);
  assert.deepEqual(row, original, 'dynamic display matching never rewrites historical content');
});
test('reviewed unified identities survive conflicting catalog names', () => {
  const row = globalThis.structuredClone(rows.find((r) => r.origin === 'ai_generation'));
  Object.assign(row.content.people[0], { id: 'person-reviewed', kind: 'person' });
  Object.assign(row.content.organizations[0], { id: 'company-reviewed', kind: 'company' });
  const entry = mapUnifiedSignalRows([row])[0];
  assert.deepEqual(
    entry.public_resources.map((r) => r.id),
    ['person-reviewed', 'company-reviewed'],
  );
  const projected = projectEditorialEntityLinks(
    [entry],
    [
      { id: 'person-other', name: entry.public_people[0].name, type: 'person', status: 'active' },
      {
        id: 'company-other',
        name: entry.public_organizations[0].name,
        type: 'company',
        status: 'active',
      },
    ],
  )[0];
  assert.deepEqual(projected.entities, ['person-reviewed', 'company-reviewed']);
});
test('reader rejects missing readiness, over-limit, duplicate, invalid and private-bearing content without fallback', async () => {
  for (const status of [[], [{ ready: false }], [{ ready: true }, { ready: true }]]) {
    let queries = 0;
    await assert.rejects(
      createUnifiedSignalReader({
        query: async () => {
          queries++;
          return { rows: status };
        },
      }).list(),
    );
    assert.equal(queries, 1);
  }
  for (const invalid of [
    [rows[0], rows[0]],
    [{ ...rows[0], origin: 'unknown' }],
    [{ ...rows[0], content: { ...rows[0].content, private: 'secret' } }],
    [{ ...rows[0], version: 0 }],
    Array(10001).fill(rows[0]),
  ]) {
    assert.throws(() => mapUnifiedSignalRows(invalid));
  }
  let calls = 0;
  assert.equal(
    (
      await createUnifiedSignalReader({
        query: async () => ({ rows: ++calls === 1 ? [{ ready: true }] : rows }),
      }).list()
    ).length,
    112,
  );
});
test('one default-off flag controls writer, pages, task snapshots and search', async () => {
  for (const value of [undefined, '', '0'])
    assert.equal(unifiedSignalEnabled({ HZENSE_UNIFIED_SIGNAL_ENABLED: value }), false);
  assert.equal(unifiedSignalEnabled({ HZENSE_UNIFIED_SIGNAL_ENABLED: '1' }), true);
  assert.throws(() => unifiedSignalEnabled({ HZENSE_UNIFIED_SIGNAL_ENABLED: 'true' }));
  for (const name of [
    'seed-runtime.ts',
    'server/editorial-review.ts',
    'server/task-public-signals.ts',
    'server/search.ts',
  ]) {
    assert.match(
      await readFile(new URL(`../../../apps/web/lib/${name}`, import.meta.url), 'utf8'),
      /unifiedSignalEnabled\(process.env\)/,
    );
  }
});
