import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Neon import credential handoff candidate', () => {
  it('retains the tested guarded AI credential flow with only target and label substitutions', async () => {
    const ai = await readFile(
      new URL('../../../db/roles/create_ai_admin.sql', import.meta.url),
      'utf8',
    );
    const candidate = await readFile(
      new URL('../../../db/roles/create_import_admin.sql', import.meta.url),
      'utf8',
    );
    expect(candidate).toBe(
      ai
        .replaceAll('hzense_ai_admin', 'hzense_import_admin')
        .replaceAll('ai_setup_result', 'import_setup_result')
        .replaceAll('HZENSE_AI_DATABASE', 'HZENSE_IMPORT_DATABASE')
        .replaceAll('AI table grants', 'import table grants')
        .replaceAll('AI role', 'Import role'),
    );
    expect(candidate).not.toMatch(/^\s*(GRANT|ALTER ROLE|DROP ROLE)\b/m);
    expect(candidate).toContain(
      'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2',
    );
    expect(candidate).toContain('administrator must submit');
  });
});
