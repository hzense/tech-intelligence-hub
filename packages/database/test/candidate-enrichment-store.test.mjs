import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  createCandidateEnrichment,
  finishCandidateEnrichment,
} from '../src/candidate-enrichment-store.mjs';

it('rejects accessors and prototype-sensitive keys before database access', async () => {
  const connect = vi.fn();
  const connectionId = randomUUID();
  const profileId = randomUUID();
  const snapshot = {
    materialHash: 'a'.repeat(64),
    source: { classification: 'private', fragments: [] },
    candidate: {},
    profile: {
      id: profileId,
      revision: 1,
      stages: { verify: { connection_id: connectionId, connection_revision: 1 } },
    },
    connection: { id: connectionId, revision: 1 },
  };
  Object.defineProperty(snapshot, 'unsafe', {
    enumerable: true,
    get() {
      throw new Error('must not execute');
    },
  });
  await expect(
    createCandidateEnrichment({
      pool: { connect },
      owner: 'admin',
      request: {
        id: randomUUID(),
        runId: randomUUID(),
        candidateIndex: 0,
        materialHash: 'a'.repeat(64),
        profileId,
        profileRevision: 1,
      },
      snapshot,
      configuration: {
        version: 'candidate-enrichment-v1',
        reserveMicrousd: 1,
        batchLimitMicrousd: 2,
        dailyLimitMicrousd: 3,
      },
    }),
  ).rejects.toMatchObject({ code: 'invalid_snapshot' });
  expect(connect).not.toHaveBeenCalled();
});

it.each([undefined, 0, 19])(
  'persists provider cost %s without altering the reservation',
  async (cost) => {
    const id = randomUUID();
    const token = randomUUID();
    let saved;
    const client = {
      query: async (sql, parameters) => {
        if (sql.includes('FOR UPDATE'))
          return {
            rows: [
              {
                id,
                owner_id: 'admin',
                status: 'running',
                lease_token: token,
                reserved_microusd: '11',
              },
            ],
          };
        if (sql.startsWith('UPDATE public.candidate_enrichment_runs')) {
          saved = parameters;
          return { rows: [{ charged_microusd: parameters[4] }] };
        }
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const result = await finishCandidateEnrichment({
      pool: { connect: async () => client },
      owner: 'admin',
      id,
      token,
      outcome: 'failed',
      chargedMicrousd: 4,
      ...(cost === undefined ? {} : { providerCostMicrousd: cost }),
    });
    expect(result.charged_microusd).toBe(String(cost ?? 11));
    expect(saved[4]).toBe(String(cost ?? 11));
    expect(client.release).toHaveBeenCalled();
  },
);
