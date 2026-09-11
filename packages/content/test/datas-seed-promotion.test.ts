import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadSeedCatalog } from '../src/seed.js';

const root = new URL('../../../', import.meta.url);
const intake = new URL('docs/content-intake/2026-09-11-datas/', root);

interface Decision {
  candidate_id: string;
  status: 'imported' | 'deferred';
  signal_id?: string;
  occurred_at?: string;
  captured_at?: string;
  date_precision?: string;
  date_basis?: string;
  date_evidence_urls?: string[];
  source_id?: string;
  source_url?: string;
  scores?: Record<string, number>;
  reason?: string;
}

interface Candidate {
  id: string;
  event_key_suggestion: string;
  status: string;
  occurred_at: string | null;
  captured_at: string;
  seed_promotion: { status: string; signal_id?: string };
}

async function loadBatch() {
  const ledger = JSON.parse(await readFile(new URL('seed-promotion.json', intake), 'utf8')) as {
    input_candidate_count: number;
    imported_count: number;
    deferred_count: number;
    decisions: Decision[];
  };
  const candidates = parse(await readFile(new URL('signals.candidates.yaml', intake), 'utf8')) as {
    signals: Candidate[];
  };
  const catalog = await loadSeedCatalog(
    fileURLToPath(new URL('data/seed/', root)),
    fileURLToPath(new URL('data/taxonomy/taxonomy.yaml', root)),
  );
  return { ledger, candidates: candidates.signals, catalog };
}

describe('datas source-dated Seed promotion', () => {
  it('accounts for every accepted candidate and preserves the date / capture distinction', async () => {
    const { ledger, candidates, catalog } = await loadBatch();
    const imported = ledger.decisions.filter((d) => d.status === 'imported');
    const deferred = ledger.decisions.filter((d) => d.status === 'deferred');
    expect(ledger.input_candidate_count).toBe(candidates.length);
    expect(imported).toHaveLength(ledger.imported_count);
    expect(deferred).toHaveLength(ledger.deferred_count);
    expect(new Set(ledger.decisions.map((d) => d.candidate_id)).size).toBe(candidates.length);
    expect(ledger.decisions.map((d) => d.candidate_id).sort()).toEqual(
      candidates.map((c) => c.id).sort(),
    );
    expect(new Set(imported.map((d) => d.signal_id)).size).toBe(imported.length);

    for (const decision of imported) {
      const candidate = candidates.find((c) => c.id === decision.candidate_id)!;
      const signal = catalog.signals.find((s) => s.id === decision.signal_id);
      expect(signal).toMatchObject({
        event_key: candidate.event_key_suggestion,
        status: 'accepted',
        occurred_at: decision.occurred_at,
        captured_at: candidate.captured_at,
        source_id: decision.source_id,
        source_url: decision.source_url,
        ...decision.scores,
      });
      expect(candidate.seed_promotion).toMatchObject({
        status: 'imported',
        signal_id: decision.signal_id,
      });
      expect(candidate.occurred_at).toBe(decision.occurred_at);
      expect(decision.captured_at).toBe(candidate.captured_at);
      expect(decision.date_precision).toBe('day');
      expect(decision.date_basis).toMatch(
        /^(event|effective|announcement|disclosure|publication)_date$/,
      );
      expect(decision.date_evidence_urls?.length).toBeGreaterThan(0);
      expect(decision.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
      expect(Date.parse(decision.occurred_at!)).toBeLessThan(Date.parse(candidate.captured_at));
    }

    for (const decision of deferred) {
      const candidate = candidates.find((c) => c.id === decision.candidate_id)!;
      expect(candidate.status).toBe('accepted');
      expect(candidate.occurred_at).toBeNull();
      expect(candidate.seed_promotion.status).toBe('deferred');
      expect(decision.reason?.length).toBeGreaterThan(0);
      expect(catalog.signals.some((s) => s.event_key === candidate.event_key_suggestion)).toBe(
        false,
      );
    }
  });

  it.each([
    ['candidate-datas-kimi-k3-subscription-pause', '2026-07-19'],
    ['candidate-datas-waymo-munich-testing', '2026-08-25'],
    ['candidate-datas-skhynix-indiana-groundbreaking', '2026-08-27'],
    ['candidate-datas-semianalysis-pjm-load-forecast', '2026-03-03'],
  ])('preserves the checked event or publication day for %s', async (candidateId, day) => {
    const { ledger } = await loadBatch();
    expect(ledger.decisions.find((d) => d.candidate_id === candidateId)).toMatchObject({
      occurred_at: `${day}T00:00:00Z`,
    });
  });
});
