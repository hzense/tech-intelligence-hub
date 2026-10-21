import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { assertRestrictedApplicationRole } from '../src/editorial-signal-role.mjs';
import { editorialVectorManifest } from '../src/editorial-vector-manifest.mjs';
import { editorialVectorValidationQuery } from '../src/editorial-vector-query.mjs';

describe('reviewed vector manifest representation', () => {
  it('expands to the exact 118-row contract pinned before deduplication', () => {
    // Captured from 0306a61, not from the refactored helper or a live database.
    // Covers every attribute, overload, aggregate dependency, type and row order.
    expect(editorialVectorManifest).toHaveLength(118);
    expect(createHash('sha256').update(JSON.stringify(editorialVectorManifest)).digest('hex')).toBe(
      '46c69266cb15e4584b611781b7392f2a1d3e1b78edea655cf2023b064ecc9d96',
    );
  });

  it('does not share mutable argument lists or aggregate records between entries', () => {
    expect(new Set(editorialVectorManifest.map((row) => row.args)).size).toBe(118);
    const aggregates = editorialVectorManifest.map((row) => row.aggregate).filter(Boolean);
    expect(aggregates).toHaveLength(4);
    expect(new Set(aggregates).size).toBe(4);
    expect(new Set(aggregates.map((entry) => entry.support_functions)).size).toBe(4);
  });
});

function clientWithVectorResult(vectorResult) {
  const calls = [];
  return {
    calls,
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql === editorialVectorValidationQuery) {
        if (vectorResult instanceof Error) throw vectorResult;
        return { rows: vectorResult };
      }
      if (sql.startsWith('SELECT current_user'))
        return { rows: [{ name: 'test_reader', safe: true }] };
      if (sql.startsWith('SELECT n.nspname')) return { rows: [] };
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ unsafe: false }] };
      throw new Error('Unexpected ACL query');
    },
  };
}

describe('bounded vector ACL validation receipt', () => {
  it('uses a pinned expected manifest and revalidates on every invocation', async () => {
    const client = clientWithVectorResult([{ safe: true }]);
    await assertRestrictedApplicationRole(client, 'test_reader', []);
    await assertRestrictedApplicationRole(client, 'test_reader', []);
    const checks = client.calls.filter((call) => call.sql === editorialVectorValidationQuery);
    expect(checks).toHaveLength(2);
    for (const check of checks)
      expect(JSON.parse(check.parameters[0])).toEqual(editorialVectorManifest);
  });

  it.each([
    ['failed match', [{ safe: false }]],
    ['unknown match', [{ safe: null }]],
    ['coerced boolean', [{ safe: 'true' }]],
    ['missing result', []],
    ['extra result', [{ safe: true }, { safe: true }]],
    ['old full manifest', editorialVectorManifest],
  ])('rejects %s before accepting column capabilities', async (_description, rows) => {
    const client = clientWithVectorResult(rows);
    await expect(assertRestrictedApplicationRole(client, 'test_reader', [])).rejects.toThrow(
      'editorial_role_invalid',
    );
    expect(client.calls).toHaveLength(2);
  });

  it('propagates a database failure before accepting column capabilities', async () => {
    const client = clientWithVectorResult(new Error('query failed'));
    await expect(assertRestrictedApplicationRole(client, 'test_reader', [])).rejects.toThrow(
      'query failed',
    );
    expect(client.calls).toHaveLength(2);
  });
});
