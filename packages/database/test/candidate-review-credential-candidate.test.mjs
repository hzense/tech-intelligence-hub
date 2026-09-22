import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Neon candidate review credential handoff candidate', () => {
  it('creates exactly the four empty restricted roles in one transaction', async () => {
    const candidate = await readFile(
      new URL('../../../db/roles/create_candidate_review_roles.sql', import.meta.url),
      'utf8',
    );
    const roles = [
      'hzense_candidate_reviewer',
      'hzense_candidate_assembler',
      'hzense_candidate_verifier',
      'hzense_publication_controller',
    ];
    for (const role of roles) expect(candidate).toContain(`'${role}'`);
    expect(candidate.match(/CREATE ROLE %I/g)).toHaveLength(1);
    expect(candidate).toContain(
      'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2',
    );
    expect(candidate).toMatch(/^BEGIN;/m);
    expect(candidate).toMatch(/^COMMIT;/m);
    expect(candidate).not.toMatch(/^\s*(GRANT|ALTER ROLE|DROP ROLE)\b/m);
    expect(candidate).toContain('administrator must submit');
    expect(candidate).toContain('stop without rotating or overwriting its password');
    expect(candidate).toContain('Unexpected membership, setting or ownership');
  });
});
