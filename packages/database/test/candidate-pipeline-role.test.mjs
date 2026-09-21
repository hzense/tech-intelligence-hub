import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  assertCandidatePipelineRole,
  candidatePipelineRoles,
  candidatePipelineAuditSQL,
  candidatePipelineProvisionSQL,
} from '../src/candidate-pipeline-role.mjs';
describe('candidate pipeline role contract', () => {
  it('checks effective privilege matrices, dedicated sessions and immutable verifier guard', () => {
    const sql = candidatePipelineAuditSQL('hzense_candidate_verifier');
    for (const token of [
      'session_user=current_user',
      'has_column_privilege',
      'has_table_privilege',
      'has_sequence_privilege',
      'has_function_privilege',
      'WITH GRANT OPTION',
      "g.tgenabled='A'",
      'sha256',
      'pg_auth_members',
    ])
      expect(sql).toContain(token);
    expect(
      candidatePipelineRoles.hzense_candidate_assembler.insert.public_source_evidence,
    ).toBeUndefined();
    expect(
      candidatePipelineRoles.hzense_candidate_assembler.insert.signal_version_people,
    ).not.toContain('verification_status');
    expect(candidatePipelineRoles.hzense_publication_controller.update).toEqual({
      signal_publication_runs: ['status', 'fencing_token', 'lease_owner', 'lease_expires_at'],
    });
    expect(() => candidatePipelineAuditSQL('neondb_owner')).toThrow(
      'candidate_pipeline_role_invalid',
    );
  });
  it('fails closed for missing/unsafe result and never modifies privileges at runtime', async () => {
    for (const rows of [[], [{ safe: false }], [{ safe: null }], [{ safe: true }, { safe: true }]])
      await expect(
        assertCandidatePipelineRole(
          { query: async () => ({ rows }) },
          'hzense_candidate_assembler',
        ),
      ).rejects.toThrow('candidate_pipeline_role_invalid');
    await assertCandidatePipelineRole(
      {
        query: async (sql) => {
          expect(sql).not.toMatch(/\b(?:GRANT|ALTER|INSERT|UPDATE)\s+(?:ON|ROLE|TABLE|INTO)/);
          return { rows: [{ safe: true }] };
        },
      },
      'hzense_candidate_assembler',
    );
  });
  it('checked-in provisioning is generated from the audited contract and is opt-in', async () => {
    const sql = await readFile(
      new URL('../../../db/roles/configure_candidate_pipeline.sql', import.meta.url),
      'utf8',
    );
    expect(sql.trim()).toBe(candidatePipelineProvisionSQL().trim());
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).not.toMatch(
      /CREATE ROLE|PASSWORD|UPDATE public\.signal_publication_(?:control|tasks|authorizations)/,
    );
    expect(sql).not.toMatch(/TO hzense_publisher/);
  });
});
