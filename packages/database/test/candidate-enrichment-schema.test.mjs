import { describe, expect, it } from 'vitest';
import {
  candidateEnrichmentChecks,
  candidateEnrichmentColumns,
  candidateEnrichmentDefaults,
  candidateEnrichmentForeignKeys,
  candidateEnrichmentIdentityPredicates,
  candidateEnrichmentIndexes,
  candidateEnrichmentPrimaryKeys,
  candidateEnrichmentUniqueIndexes,
} from '../src/candidate-enrichment-catalog.mjs';

describe('candidate enrichment schema catalog', () => {
  it('pins the private durable execution table', () => {
    expect(Object.keys(candidateEnrichmentColumns)).toEqual(['candidate_enrichment_runs']);
    expect(candidateEnrichmentColumns.candidate_enrichment_runs).toHaveProperty('snapshot');
    expect(candidateEnrichmentColumns.candidate_enrichment_runs).toHaveProperty('result');
    expect(candidateEnrichmentPrimaryKeys).toEqual(['candidate_enrichment_runs|id']);
    expect(candidateEnrichmentForeignKeys).toEqual([
      'candidate_enrichment_runs|run_id|signal_generation_runs|id|a|a|false',
    ]);
  });

  it('pins constraints, defaults and both partial and supporting indexes', () => {
    expect(candidateEnrichmentChecks.candidate_enrichment_runs).toHaveLength(11);
    expect(candidateEnrichmentDefaults).toHaveLength(4);
    expect(candidateEnrichmentUniqueIndexes).toEqual([
      'candidate_enrichment_runs|owner_id,run_id,candidate_index,material_hash,profile_id,profile_revision',
    ]);
    expect(candidateEnrichmentIndexes).toEqual([
      'candidate_enrichment_runs|owner_id,created_at',
      'candidate_enrichment_runs|budget_day',
    ]);
    expect(candidateEnrichmentIdentityPredicates).toContain("status<>'failed'");
  });
});
