import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const batch = fileURLToPath(new URL('../', import.meta.url));
const yaml = async (path) => parse(await readFile(path, 'utf8'));
const before = JSON.parse(await readFile(resolve(batch, 'existing-before.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(batch, 'input-manifest.json'), 'utf8'));
const seed = await yaml(resolve(root, 'data/seed/signals.yaml'));
const seedEntities = await yaml(resolve(root, 'data/seed/entities.yaml'));
const seedTopics = await yaml(resolve(root, 'data/seed/topics.yaml'));
const backfill = await yaml(resolve(batch, 'entity-backfill.yaml'));
const files = ['july-august-candidates.yaml', 'september-candidates.yaml'];
const bundles = await Promise.all(files.map((file) => yaml(resolve(batch, file))));
const completion = await yaml(
  resolve(batch, '../2026-09-29-pending-signal-completion/signals.candidates.yaml'),
);
const revisions = new Map(completion.signals.map((signal) => [signal.id, signal]));
const candidates = bundles.flatMap((bundle) =>
  bundle.signals.map((signal) => revisions.get(signal.id) ?? signal),
);
let publication = null;
try {
  publication = JSON.parse(await readFile(resolve(batch, 'publication.json'), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const acceptance = JSON.parse(
  await readFile(resolve(batch, '../2026-09-30-signal-acceptance/publication.json'), 'utf8'),
);
const acceptedIds = new Set(
  [...(publication?.accepted ?? []), ...acceptance.accepted].map((entry) => entry.signal_id),
);
const entities = new Map(
  [...seedEntities, ...bundles.flatMap((bundle) => bundle.entities), ...completion.entities].map(
    (entity) => [entity.id, entity],
  ),
);
const gap = (signal) => ({
  missing_person: !signal.entities.some((id) => entities.get(id)?.type === 'person'),
  missing_organization: !signal.entities.some((id) =>
    ['company', 'institution'].includes(entities.get(id)?.type),
  ),
});
const gaps = (signals) =>
  signals
    .map((signal) => ({ id: signal.id, title: signal.title, ...gap(signal) }))
    .filter((entry) => entry.missing_person || entry.missing_organization);
const changed = (field) =>
  before
    .filter(
      (old) =>
        JSON.stringify(seed.find((item) => item.id === old.id)?.[field]) !==
        JSON.stringify(old[field]),
    )
    .map((signal) => signal.id);
const counts = (values) =>
  Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((item) => item === value).length]),
  );
const metadataChanges = ['type', 'occurred_at', 'source_id', 'source_url'].flatMap((field) =>
  changed(field).map((id) => ({ id, field })),
);
const summary = {
  schema: 'hzense-daily-signal-review-result-v1',
  reviewed_on: '2026-09-29',
  input: { files: manifest.file_count, bytes: manifest.total_bytes, lines: manifest.total_lines },
  existing: {
    count_before: before.length,
    count_after: seed.length,
    changed_topics: changed('topics'),
    changed_entity_roles: changed('entity_roles'),
    identity_date_source_type_changes: metadataChanges,
    before_missing_people: before
      .filter((signal) => gap(signal).missing_person)
      .map((signal) => signal.id),
    before_missing_organizations: before
      .filter((signal) => gap(signal).missing_organization)
      .map((signal) => signal.id),
    remaining_gaps: gaps(seed),
    registered_entities: backfill.entities.map(({ id, type }) => ({ id, type })),
    seed_topic_count: seedTopics.length,
  },
  candidates: {
    count: candidates.length,
    research_snapshot_status: 'inbox',
    confirmed_for_seed: acceptedIds.size,
    pending: candidates.length - acceptedIds.size,
    deployment_verified: false,
    bundle_counts: Object.fromEntries(
      files.map((file, index) => [file, bundles[index].signals.length]),
    ),
    type_counts: counts(candidates.map((signal) => signal.type)),
    four_fields_complete: candidates.filter(
      (signal) => !gap(signal).missing_person && !gap(signal).missing_organization,
    ).length,
    remaining_gaps: gaps(candidates),
    extra_topics_needed_before_promotion: [
      ...new Set(candidates.flatMap((signal) => signal.topics)),
    ]
      .filter((id) => !seedTopics.some((topic) => topic.id === id))
      .sort(),
  },
};

if (process.argv[2] === 'markdown') {
  const lines = [
    '# 本批候选信号清单',
    '',
    `共 ${candidates.length} 条；${acceptedIds.size} 条已获用户确认，${candidates.length - acceptedIds.size} 条未确认。上线状态需另行核验。确认决定合并本批 publication.json 与 ../2026-09-30-signal-acceptance/publication.json；其中 5 条采用 ../2026-09-29-pending-signal-completion/signals.candidates.yaml 的修订稿，原候选 inbox 保留为历史快照。`,
    '',
    '类型每条唯一；主题为多值。完整摘要、来源、角色、评分依据、日级时间依据和限制见原候选与补全修订档案。确认记录是历史审核决定，不代替执行时的正式 Seed 或生产状态查询。',
    '',
    '| 事件日 | 标题 | 唯一类型 | 人物 | 组织 | 当前确认状态 |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const names = (signal, types) =>
    signal.entities
      .filter((id) => types.includes(entities.get(id)?.type))
      .map((id) => entities.get(id).name)
      .join('、') || '未核实';
  for (const signal of [...candidates].sort(
    (a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id),
  )) {
    const state = gap(signal);
    lines.push(
      `| ${signal.occurred_at.slice(0, 10)} | ${signal.title} | \`${signal.type}\` | ${names(signal, ['person'])} | ${names(signal, ['company', 'institution'])} | ${acceptedIds.has(signal.id) ? '已确认入正式 Seed' : state.missing_person || state.missing_organization ? '待补' : '齐全待审'} |`,
    );
  }
  lines.push('', '## 未记录人物或组织的条目', '', '| Signal ID | 空缺字段 |', '| --- | --- |');
  for (const entry of summary.candidates.remaining_gaps)
    lines.push(
      `| \`${entry.id}\` | ${[entry.missing_person && '人物', entry.missing_organization && '组织'].filter(Boolean).join('、')} |`,
    );
  lines.push(
    '',
    '未核实处保留空值；这不是待审核清单。按类型规则已接受的机构事件或作者研究可以保留相应空值。不以无关高管补位，不把新闻媒体或研究平台强行当作事件经营组织。',
    '',
  );
  console.log(lines.join('\n'));
} else {
  console.log(JSON.stringify(summary, null, 2));
}
