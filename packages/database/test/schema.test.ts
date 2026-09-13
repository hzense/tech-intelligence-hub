import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  affiliationEvidence,
  entities,
  organizationProfiles,
  personProfiles,
  personOrganizationAffiliations,
  publicSourceEvidence,
  radarSnapshots,
  radarSnapshotSignals,
  relations,
  searchDocuments,
  signals,
  signalVersionEvidence,
  signalVersionOrganizations,
  signalVersionPeople,
  signalVersionTopics,
  signalVersions,
  sources,
  topics,
} from '../src/schema.js';
import { affiliationChecks, affiliationRelationChecks } from '../src/affiliation-catalog.mjs';
import { canonicalCatalogExpression } from '../src/verify.mjs';

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe('Person organization affiliation foundation', () => {
  const tables = [personOrganizationAffiliations, affiliationEvidence];

  it('reuses the exact directed relation identity and leaves dates in one place', () => {
    expect(columnNames(personOrganizationAffiliations)).toEqual([
      'relation_id',
      'person_id',
      'organization_id',
      'relation_type',
      'role_title',
      'date_basis',
      'verification_status',
    ]);
    expect(columnNames(affiliationEvidence)).toEqual([
      'relation_id',
      'evidence_id',
      'claim',
      'relation',
      'verification_status',
    ]);
    expect(columnNames(relations)).toEqual(expect.arrayContaining(['valid_from', 'valid_to']));
    expect(tables.flatMap(columnNames)).not.toEqual(expect.arrayContaining(['valid_from']));
    expect(tables.flatMap(columnNames)).not.toEqual(expect.arrayContaining(['valid_to']));
    const identity = getTableConfig(relations).indexes.find(
      (index) => index.config.name === 'relations_identity_uq',
    );
    expect(identity?.config.unique).toBe(true);
    expect(identity?.config.columns.map((column) => 'name' in column && column.name)).toEqual([
      'id',
      'source_id',
      'target_id',
      'relation_type',
    ]);
    const reference = getTableConfig(personOrganizationAffiliations).foreignKeys[0].reference();
    expect(getTableName(reference.foreignTable)).toBe('relations');
    expect(reference.columns.map((column) => column.name)).toEqual([
      'relation_id',
      'person_id',
      'organization_id',
      'relation_type',
    ]);
    expect(reference.foreignColumns.map((column) => column.name)).toEqual([
      'id',
      'source_id',
      'target_id',
      'relation_type',
    ]);
    expect(
      getTableConfig(personOrganizationAffiliations).foreignKeys.map((key) =>
        getTableName(key.reference().foreignTable),
      ),
    ).toEqual(['relations', 'person_profiles', 'organization_profiles']);
  });

  it('allows repeat appointments and multiple evidence without declaring verification or publication', () => {
    expect(personOrganizationAffiliations.relationId.primary).toBe(true);
    expect(
      getTableConfig(personOrganizationAffiliations).indexes.every((index) => !index.config.unique),
    ).toBe(true);
    expect(
      getTableConfig(affiliationEvidence).primaryKeys[0].columns.map((column) => column.name),
    ).toEqual(['relation_id', 'evidence_id']);
    expect(personOrganizationAffiliations.verificationStatus.default).toBe('pending');
    expect(affiliationEvidence.verificationStatus.default).toBe('pending');
    for (const table of tables) {
      for (const key of getTableConfig(table).foreignKeys) {
        expect(key.onUpdate).toBe('no action');
        expect(key.onDelete).toBe('no action');
      }
    }
  });

  it('keeps Drizzle constraints equal to the independent exact catalog', () => {
    const dialect = new PgDialect();
    for (const table of [...tables, relations]) {
      const config = getTableConfig(table);
      const checks =
        config.name === 'relations'
          ? config.checks.filter((constraint) => constraint.name.startsWith('relations_valid_'))
          : config.checks;
      const expected =
        config.name === 'relations'
          ? affiliationRelationChecks
          : affiliationChecks[config.name as keyof typeof affiliationChecks];
      const actual = checks.map((constraint) =>
        canonicalCatalogExpression(
          dialect
            .sqlToQuery(constraint.value)
            .sql.replace(/"[a-z_]+"\."([a-z_]+)"/g, '$1')
            .replace(/DATE ('[^']*')/g, '$1')
            .replace(/ IN \(([^)]+)\)/g, '=ANY(ARRAY[$1])'),
        ),
      );
      expect(actual).toHaveLength(expected.length);
      for (const [index, expression] of actual.entries()) {
        expect(expected[index]).toContain(expression);
        expect(expected[index]).not.toContain(`${expression}ortrue`);
      }
    }
  });

  it('ships append-only fail-closed DDL without data rewrites or privileges', async () => {
    const migration = await readFile(
      resolve(process.cwd(), '../../db/migrations/0005_person_organization_affiliations.sql'),
      'utf8',
    );
    const normalized = migration
      .replace(/\s+/g, ' ')
      .replace(/CHECK \( /g, 'CHECK (')
      .replace(/ \),/g, '),')
      .replace(/ \);/g, ');');
    const dialect = new PgDialect();
    for (const table of [...tables, relations]) {
      const config = getTableConfig(table);
      const checks =
        config.name === 'relations'
          ? config.checks.filter((constraint) => constraint.name.startsWith('relations_valid_'))
          : config.checks;
      for (const constraint of checks) {
        const expression = dialect
          .sqlToQuery(constraint.value)
          .sql.replace(/"[a-z_]+"\."([a-z_]+)"/g, '$1')
          .replace(/\s+/g, ' ');
        expect(normalized).toContain(`CONSTRAINT ${constraint.name} CHECK (${expression})`);
        expect(constraint.name.length).toBeLessThanOrEqual(63);
      }
      if (table === relations) continue;
      for (const key of config.foreignKeys) {
        const reference = key.reference();
        expect(normalized).toContain(
          `CONSTRAINT ${key.getName()} FOREIGN KEY (${reference.columns.map((column) => column.name).join(', ')}) REFERENCES ${getTableName(reference.foreignTable)}(${reference.foreignColumns.map((column) => column.name).join(', ')}) ON UPDATE NO ACTION ON DELETE NO ACTION`,
        );
      }
      for (const index of config.indexes) {
        expect(normalized).toContain(
          `CREATE INDEX ${index.config.name} ON ${config.name}(${index.config.columns.map((column) => 'name' in column && column.name).join(', ')})`,
        );
      }
    }
    const executable = migration.replace(/^--.*$/gm, '');
    expect(executable).not.toMatch(/\b(?:GRANT|TRIGGER|FUNCTION|VIEW|POLICY|NOT VALID)\b/i);
    expect(executable).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE\s+relations|DELETE\s+FROM|CASCADE)\b/i,
    );
  });
});

describe('Radar evidence persistence schema', () => {
  it('keeps Signal and Radar evidence fields aligned with the information model', () => {
    expect(columnNames(signals)).toContain('source_url');
    expect(columnNames(sources)).toContain('allowed_hosts');
    expect(columnNames(radarSnapshots)).toEqual(expect.arrayContaining(['domain', 'reasoning']));
    expect(columnNames(radarSnapshotSignals)).toEqual(['snapshot_id', 'signal_id', 'position']);

    const evidenceConfig = getTableConfig(radarSnapshotSignals);
    expect(evidenceConfig.primaryKeys).toHaveLength(1);
    expect(evidenceConfig.foreignKeys).toHaveLength(2);
  });

  it('ships an expand-backfill-constrain SQL migration for the evidence contract', async () => {
    const migration = await readFile(
      resolve(process.cwd(), '../../db/migrations/0001_radar_evidence.sql'),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN allowed_hosts text[];');
    expect(migration).toContain('ADD COLUMN source_url text;');
    expect(migration).toContain('ADD COLUMN domain radar_domain;');
    expect(migration).toContain('ADD COLUMN reasoning text;');
    expect(migration).toContain('requires an exact source_url backfill');
    expect(migration).toContain('LOCK TABLE signal_topics IN SHARE ROW EXCLUSIVE MODE');
    expect(migration).toContain("SET occurred_at = '2024-06-21T00:00:00Z'");
    expect(migration).toContain("'radar-20260827-ai-security',");
    expect(migration).toContain("'medium',\n      0.4,");
    expect(migration).toContain('ALTER TABLE signals ALTER COLUMN source_url SET NOT NULL');
    expect(migration).not.toContain('ADD COLUMN source_url text NOT NULL');
    expect(migration).toContain('CREATE TABLE radar_snapshot_signals');
    expect(migration).toContain('radar_snapshot_signal_position_uq');
    expect(migration).toContain('INSERT INTO radar_snapshot_signals');
    expect(migration).toContain('requires at least one persisted evidence signal per snapshot');
  });
});

describe('Topic runtime projection schema', () => {
  it('keeps runtime eligibility separate from canonical Topic identity and status', () => {
    const topicConfig = getTableConfig(topics);

    expect(columnNames(topics)).toEqual([
      'id',
      'title',
      'parent_id',
      'status',
      'metadata',
      'runtime_enabled',
    ]);
    expect(topicConfig.checks.map((constraint) => constraint.name)).toContain(
      'topics_runtime_enabled_status_ck',
    );
  });

  it('ships an append-only migration with the reviewed runtime backfill', async () => {
    const migration = await readFile(
      resolve(process.cwd(), '../../db/migrations/0002_topic_projection.sql'),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN runtime_enabled boolean NOT NULL DEFAULT false;');
    expect(migration).toContain("SET runtime_enabled = status IN ('active', 'strategic');");
    expect(migration).toContain("CHECK (NOT runtime_enabled OR status <> 'archived');");
  });
});

describe('FTS-1 Search Document schema', () => {
  it('models the persisted display, normalized and generated search fields', () => {
    expect(columnNames(searchDocuments)).toEqual([
      'id',
      'source_id',
      'source_type',
      'title',
      'summary',
      'href',
      'keywords',
      'body',
      'importance',
      'document_date',
      'topics',
      'entities',
      'embedding',
      'normalized_title',
      'normalized_summary',
      'normalized_keywords',
      'normalized_body',
      'search_vector',
    ]);
    const config = getTableConfig(searchDocuments);
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'search_source_idx',
        'search_documents_source_identity_uq',
        'search_documents_date_idx',
        'search_documents_fts_idx',
      ]),
    );
  });

  it('ships an append-only guarded persistence and GIN-index migration', async () => {
    const migration = await readFile(
      resolve(process.cwd(), '../../db/migrations/0003_search_documents_fts.sql'),
      'utf8',
    );

    expect(migration).toContain('requires an empty derived search_documents table');
    expect(migration).toContain('ADD COLUMN summary text NOT NULL');
    expect(migration).toContain('ADD COLUMN search_vector tsvector GENERATED ALWAYS AS');
    expect(migration).toContain("to_tsvector('pg_catalog.simple'::regconfig");
    expect(migration).toContain('USING gin(search_vector)');
  });
});

describe('Signal 3.0.0 private storage foundation', () => {
  const foundationTables = [
    personProfiles,
    organizationProfiles,
    publicSourceEvidence,
    signalVersions,
    signalVersionEvidence,
    signalVersionPeople,
    signalVersionOrganizations,
    signalVersionTopics,
  ];

  it('stores the complete version snapshot without assigning public eligibility', () => {
    expect(columnNames(signalVersions)).toEqual([
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
      'created_at',
    ]);
    const config = getTableConfig(signalVersions);
    expect(config.primaryKeys[0].columns.map((column) => column.name)).toEqual([
      'signal_id',
      'version',
    ]);
    expect(signalVersions.schemaVersion.default).toBe('3.0.0');
    expect(signalVersions.analysis.notNull).toBe(false);
    expect(signalVersions.legacyStatus.notNull).toBe(false);
    expect(signalVersions.capturedAt.hasDefault).toBe(false);
    expect(signalVersions.createdAt.hasDefault).toBe(true);
    for (const field of ['published_at', 'publication_status', 'current_version']) {
      expect(foundationTables.flatMap(columnNames)).not.toContain(field);
    }
  });

  it('binds person and organization profiles to the matching entity identity and type', () => {
    const identityIndex = getTableConfig(entities).indexes.find(
      (index) => index.config.name === 'entities_id_type_uq',
    );
    expect(identityIndex?.config.unique).toBe(true);
    expect(identityIndex?.config.columns.map((column) => 'name' in column && column.name)).toEqual([
      'id',
      'type',
    ]);

    for (const table of [personProfiles, organizationProfiles]) {
      const reference = getTableConfig(table).foreignKeys[0].reference();
      expect(reference.columns.map((column) => column.name)).toEqual(['entity_id', 'entity_type']);
      expect(getTableName(reference.foreignTable)).toBe('entities');
      expect(reference.foreignColumns.map((column) => column.name)).toEqual(['id', 'type']);
    }
  });

  it('allows multiple evidence rows per person or organization only within the exact version', () => {
    for (const [table, profile, entityColumn] of [
      [signalVersionPeople, personProfiles, 'person_id'],
      [signalVersionOrganizations, organizationProfiles, 'organization_id'],
    ] as const) {
      const config = getTableConfig(table);
      expect(config.primaryKeys[0].columns.map((column) => column.name)).toEqual([
        'signal_id',
        'version',
        entityColumn,
        'evidence_id',
      ]);
      const references = config.foreignKeys.map((foreignKey) => foreignKey.reference());
      expect(references.map((reference) => getTableName(reference.foreignTable))).toEqual([
        getTableName(profile),
        'signal_version_evidence',
      ]);
      const evidenceReference = references[1];
      expect(evidenceReference.columns.map((column) => column.name)).toEqual([
        'signal_id',
        'version',
        'evidence_id',
      ]);
      expect(evidenceReference.foreignColumns.map((column) => column.name)).toEqual([
        'signal_id',
        'version',
        'evidence_id',
      ]);
    }
  });

  it('requires collected source evidence and preserves pending verification defaults', () => {
    expect(columnNames(publicSourceEvidence)).toEqual([
      'id',
      'source_id',
      'source_url',
      'locator',
      'excerpt',
      'content_hash',
      'captured_at',
      'source_published_at',
      'verification_status',
    ]);
    expect(publicSourceEvidence.sourcePublishedAt.notNull).toBe(false);
    expect(publicSourceEvidence.capturedAt.hasDefault).toBe(false);
    for (const table of [publicSourceEvidence, signalVersionPeople, signalVersionOrganizations]) {
      expect(table.verificationStatus.default).toBe('pending');
    }
    for (const table of foundationTables) {
      for (const foreignKey of getTableConfig(table).foreignKeys) {
        expect(foreignKey.onDelete).toBe('no action');
        expect(foreignKey.onUpdate).toBe('no action');
      }
    }
  });

  it('keeps SQL and Drizzle checks, foreign keys, keys and indexes identical', async () => {
    const migration = await readFile(
      resolve(process.cwd(), '../../db/migrations/0004_signal_version_foundation.sql'),
      'utf8',
    );
    const normalizedMigration = migration.replace(/\s+/g, ' ');
    const dialect = new PgDialect();
    for (const table of foundationTables) {
      const config = getTableConfig(table);
      expect(migration).toContain(`CREATE TABLE ${config.name} (`);
      for (const constraint of config.checks) {
        const expression = dialect
          .sqlToQuery(constraint.value)
          .sql.replace(/"[a-z_]+"\."([a-z_]+)"/g, '$1')
          .replace(/\s+/g, ' ');
        expect(normalizedMigration).toContain(
          `CONSTRAINT ${constraint.name} CHECK (${expression})`,
        );
        expect(constraint.name.length).toBeLessThanOrEqual(63);
      }
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        const localColumns = reference.columns.map((column) => column.name).join(', ');
        const foreignColumns = reference.foreignColumns.map((column) => column.name).join(', ');
        expect(normalizedMigration).toContain(
          `CONSTRAINT ${foreignKey.getName()} FOREIGN KEY (${localColumns}) REFERENCES ${getTableName(reference.foreignTable)}(${foreignColumns}) ON UPDATE NO ACTION ON DELETE NO ACTION`,
        );
        expect(foreignKey.getName().length).toBeLessThanOrEqual(63);
      }
      for (const primaryKey of config.primaryKeys) {
        expect(normalizedMigration).toContain(
          `CONSTRAINT ${primaryKey.getName()} PRIMARY KEY (${primaryKey.columns.map((column) => column.name).join(', ')})`,
        );
        expect(primaryKey.getName().length).toBeLessThanOrEqual(63);
      }
      for (const index of config.indexes) {
        expect(normalizedMigration).toContain(
          `CREATE INDEX ${index.config.name} ON ${config.name}(`,
        );
      }
    }
    const executableSql = migration.replace(/^--.*$/gm, '');
    expect(executableSql).not.toMatch(
      /\b(?:GRANT|TRIGGER|FUNCTION|VIEW|POLICY|ROW LEVEL SECURITY)\b/i,
    );
    expect(executableSql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|signals)\b/i);
    expect(executableSql).not.toMatch(/\bALTER\s+TABLE\b/i);
  });
});
