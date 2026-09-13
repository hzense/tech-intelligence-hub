// Offline ACL contract only. No credentials, database clients or production entrypoint.
export const signalWriterRoleName = 'hzense_signal_writer';
export const signalWriterRequiredMigration = '0007_signal_version_immutability.sql';
export const signalWriterSelectTables = Object.freeze([
  'sources',
  'entities',
  'topics',
  'person_profiles',
  'organization_profiles',
  'signals',
  'public_source_evidence',
  'signal_versions',
  'signal_version_evidence',
  'signal_version_people',
  'signal_version_organizations',
  'signal_version_topics',
  'signal_event_identities',
  'hzense_schema_migrations',
]);
export const signalWriterInsertColumns = Object.freeze(
  Object.fromEntries(
    Object.entries({
      signals: [
        'id',
        'title',
        'type',
        'occurred_at',
        'captured_at',
        'source_id',
        'source_url',
        'summary',
        'importance',
        'strength',
        'confidence',
        'novelty',
        'metadata',
      ],
      public_source_evidence: [
        'id',
        'source_id',
        'source_url',
        'locator',
        'excerpt',
        'content_hash',
        'captured_at',
        'source_published_at',
      ],
      signal_versions: [
        'signal_id',
        'version',
        'schema_version',
        'title',
        'type',
        'occurred_at',
        'date_precision',
        'date_basis',
        'captured_at',
        'summary',
        'analysis',
        'importance',
        'strength',
        'confidence',
        'novelty',
        'revision_reason',
        'origin',
        'legacy_status',
        'content_hash',
      ],
      signal_version_evidence: ['signal_id', 'version', 'evidence_id', 'claim', 'relation'],
      signal_version_people: ['signal_id', 'version', 'person_id', 'evidence_id', 'event_role'],
      signal_version_organizations: [
        'signal_id',
        'version',
        'organization_id',
        'evidence_id',
        'event_role',
      ],
      signal_version_topics: ['signal_id', 'version', 'topic_id'],
      signal_event_identities: [
        'signal_id',
        'event_key',
        'basis_version',
        'basis_evidence_id',
        'identity_basis',
      ],
    }).map(([table, columns]) => [table, Object.freeze(columns)]),
  ),
);

/** Expected DIRECT grants in the current database; ambient permissions are checked by SQL. */
export function expectedSignalWriterGrants() {
  return [
    { kind: 'database', object: 'current_database', privilege: 'CONNECT', grant_option: false },
    { kind: 'schema', object: 'public', privilege: 'USAGE', grant_option: false },
    ...signalWriterSelectTables.map((table) => ({
      kind: 'table',
      object: `public.${table}`,
      privilege: 'SELECT',
      grant_option: false,
    })),
    ...Object.entries(signalWriterInsertColumns).flatMap(([table, columns]) =>
      columns.map((column) => ({
        kind: 'column',
        object: `public.${table}`,
        column,
        privilege: 'INSERT',
        grant_option: false,
      })),
    ),
  ];
}

/** Fail-closed exact-set check, never a claim that uncollected/ambient ACLs are safe. */
export function inspectSignalWriterGrants(input) {
  if (!Array.isArray(input)) return { ok: false, problems: ['Grant collection must be an array'] };
  const fingerprint = (row) =>
    JSON.stringify([row.kind, row.object, row.column ?? null, row.privilege, row.grant_option]);
  const expected = new Set(expectedSignalWriterGrants().map(fingerprint));
  const actual = new Set();
  const problems = [];
  for (const row of input) {
    if (
      row === null ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).some(
        (key) => !['kind', 'object', 'column', 'privilege', 'grant_option'].includes(key),
      ) ||
      typeof row.kind !== 'string' ||
      typeof row.object !== 'string' ||
      typeof row.privilege !== 'string' ||
      typeof row.grant_option !== 'boolean' ||
      (row.column !== undefined && typeof row.column !== 'string')
    ) {
      problems.push('Malformed grant record');
      continue;
    }
    const key = fingerprint(row);
    if (actual.has(key)) problems.push(`Duplicate grant: ${key}`);
    actual.add(key);
    if (!expected.has(key)) problems.push(`Unexpected grant: ${key}`);
  }
  for (const key of expected) if (!actual.has(key)) problems.push(`Missing grant: ${key}`);
  return { ok: problems.length === 0, problems: problems.sort() };
}
