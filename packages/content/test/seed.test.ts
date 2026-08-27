import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSeedCatalog } from '../src/seed.js';

const temporaryRoots: string[] = [];

async function createSeedRoot(
  occurredAt: string,
  signalSourceId = 'source-example',
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hzense-seed-'));
  temporaryRoots.push(root);

  await Promise.all([
    writeFile(join(root, 'entities.yaml'), '[]\n'),
    writeFile(join(root, 'radar.yaml'), '[]\n'),
    writeFile(join(root, 'relations.yaml'), '[]\n'),
    writeFile(
      join(root, 'sources.yaml'),
      '- id: source-example\n  name: Example\n  type: website\n  trust_score: 80\n  active: true\n',
    ),
    writeFile(join(root, 'topics.yaml'), '[]\n'),
    writeFile(
      join(root, 'signals.yaml'),
      `- id: signal-example
  title: Example signal
  type: technology
  occurred_at: ${occurredAt}
  captured_at: 2026-08-20T00:00:00Z
  status: reviewed
  source_id: ${signalSourceId}
  summary: Example summary
  importance: 3
  strength: 3
  confidence: 0.8
  novelty: 0.7
  topics: []
  entities: []
`,
    ),
  ]);

  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('seed datetime validation', () => {
  it('accepts a valid leap-day ISO datetime', async () => {
    const root = await createSeedRoot('2024-02-29T00:00:00Z');

    await expect(loadSeedCatalog(root)).resolves.toMatchObject({
      signals: [{ occurred_at: '2024-02-29T00:00:00Z' }],
    });
  });

  it('rejects an impossible calendar date', async () => {
    const root = await createSeedRoot('2024-02-30T00:00:00Z');

    await expect(loadSeedCatalog(root)).rejects.toThrow();
  });
});

describe('seed reference validation', () => {
  it('rejects a Signal whose source does not exist', async () => {
    const root = await createSeedRoot('2024-02-29T00:00:00Z', 'source-missing');

    await expect(loadSeedCatalog(root)).rejects.toThrow('Unknown source: signal-example');
  });

  it('rejects a Radar snapshot whose Topic does not exist', async () => {
    const root = await createSeedRoot('2024-02-29T00:00:00Z');
    await writeFile(
      join(root, 'radar.yaml'),
      `- id: radar-missing
  topic: topic-missing
  date: 2026-08-27
  domain: artificial_intelligence
  attention: 80
  trend: growth
  maturity: emerging
  strategic_value: high
  confidence: 0.9
`,
    );

    await expect(loadSeedCatalog(root)).rejects.toThrow(
      'Unknown topic topic-missing in radar-missing',
    );
  });
});
