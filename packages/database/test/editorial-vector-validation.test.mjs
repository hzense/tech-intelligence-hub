import { describe, expect, it } from 'vitest';
import { assertRestrictedApplicationRole } from '../src/editorial-signal-role.mjs';
import { editorialVectorManifest } from '../src/editorial-vector-manifest.mjs';
import { editorialVectorValidationQuery } from '../src/editorial-vector-query.mjs';

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
