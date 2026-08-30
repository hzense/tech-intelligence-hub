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
      join(root, 'taxonomy.yaml'),
      `version: '1.0'
project: HZense
root_topics:
  - id: topic-example
    name: Example Topic
cross_domain_relations: []
`,
    ),
    writeFile(
      join(root, 'sources.yaml'),
      '- id: source-example\n  name: Example\n  type: website\n  trust_score: 80\n  active: true\n  allowed_hosts: [example.com]\n',
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
  source_url: https://example.com/signal
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

function loadFixtureCatalog(root: string) {
  return loadSeedCatalog(root, join(root, 'taxonomy.yaml'));
}

interface RadarSeedOptions {
  capturedAt?: string;
  evidenceSignals?: string[];
  occurredAt?: string;
  reasoning?: string;
  signalStatus?: string;
  signalTopics?: string[];
  sourceUrl?: string;
  topicStatus?: string;
}

async function createRadarSeedRoot({
  capturedAt = '2026-08-20T00:00:00Z',
  evidenceSignals = ['signal-example'],
  occurredAt = '2024-02-29T00:00:00Z',
  reasoning = 'Example editorial reasoning',
  signalStatus = 'reviewed',
  signalTopics = ['topic-example'],
  sourceUrl = 'https://example.com/signal',
  topicStatus = 'active',
}: RadarSeedOptions = {}): Promise<string> {
  const root = await createSeedRoot(occurredAt);
  await Promise.all([
    writeFile(
      join(root, 'topics.yaml'),
      `- id: topic-example\n  title: Example Topic\n  status: ${topicStatus}\n`,
    ),
    writeFile(
      join(root, 'signals.yaml'),
      `- id: signal-example
  title: Example signal
  type: technology
  occurred_at: ${occurredAt}
  captured_at: ${capturedAt}
  status: ${signalStatus}
  source_id: source-example
  source_url: ${sourceUrl}
  summary: Example summary
  importance: 3
  strength: 3
  confidence: 0.8
  novelty: 0.7
  topics: [${signalTopics.join(', ')}]
  entities: []
`,
    ),
    writeFile(
      join(root, 'radar.yaml'),
      `- id: radar-example
  topic: topic-example
  date: 2026-08-27
  domain: artificial_intelligence
  attention: 80
  trend: growth
  maturity: emerging
  strategic_value: high
  confidence: 0.9
  evidence_signals: [${evidenceSignals.join(', ')}]
  reasoning: ${JSON.stringify(reasoning)}
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

    await expect(loadFixtureCatalog(root)).resolves.toMatchObject({
      signals: [{ occurred_at: '2024-02-29T00:00:00Z' }],
    });
  });

  it('rejects an impossible calendar date', async () => {
    const root = await createSeedRoot('2024-02-30T00:00:00Z');

    await expect(loadFixtureCatalog(root)).rejects.toThrow();
  });
});

describe('seed reference validation', () => {
  it('rejects a Seed Topic that is outside the authoritative Taxonomy', async () => {
    const root = await createSeedRoot('2024-02-29T00:00:00Z');
    await writeFile(
      join(root, 'topics.yaml'),
      '- id: topic-outside\n  title: Outside Topic\n  status: active\n',
    );

    await expect(loadFixtureCatalog(root)).rejects.toThrow(
      'Seed Topic topic-outside is not defined in Taxonomy',
    );
  });

  it('rejects a Seed Topic whose canonical title drifts from Taxonomy', async () => {
    const root = await createSeedRoot('2024-02-29T00:00:00Z');
    await writeFile(
      join(root, 'topics.yaml'),
      '- id: topic-example\n  title: Drifted title\n  status: active\n',
    );

    await expect(loadFixtureCatalog(root)).rejects.toThrow(
      'Seed Topic title mismatch for topic-example: expected "Example Topic", received "Drifted title"',
    );
  });

  it('rejects a Signal whose source does not exist', async () => {
    const root = await createSeedRoot('2024-02-29T00:00:00Z', 'source-missing');

    await expect(loadFixtureCatalog(root)).rejects.toThrow('Unknown source: signal-example');
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
  evidence_signals: [signal-example]
  reasoning: Example reasoning
`,
    );

    await expect(loadFixtureCatalog(root)).rejects.toThrow(
      'Unknown topic topic-missing in radar-missing',
    );
  });

  it('rejects a Radar snapshot for an archived Topic', async () => {
    const root = await createRadarSeedRoot({ topicStatus: 'archived' });

    await expect(loadFixtureCatalog(root)).rejects.toThrow(
      'Archived topic topic-example in radar-example',
    );
  });

  it('rejects public Signals that reference an archived Topic', async () => {
    const reviewedRoot = await createRadarSeedRoot({ topicStatus: 'archived' });
    const acceptedRoot = await createRadarSeedRoot({
      signalStatus: 'accepted',
      topicStatus: 'archived',
    });
    await Promise.all([
      writeFile(join(reviewedRoot, 'radar.yaml'), '[]\n'),
      writeFile(join(acceptedRoot, 'radar.yaml'), '[]\n'),
    ]);

    await expect(loadFixtureCatalog(reviewedRoot)).rejects.toThrow(
      'Public Signal signal-example references archived topic topic-example',
    );
    await expect(loadFixtureCatalog(acceptedRoot)).rejects.toThrow(
      'Public Signal signal-example references archived topic topic-example',
    );
  });

  it('allows internal historical Signals to retain archived Topic references', async () => {
    const roots = await Promise.all(
      ['inbox', 'rejected', 'archived'].map((signalStatus) =>
        createRadarSeedRoot({ signalStatus, topicStatus: 'archived' }),
      ),
    );
    await Promise.all(roots.map((root) => writeFile(join(root, 'radar.yaml'), '[]\n')));

    await Promise.all(roots.map((root) => expect(loadFixtureCatalog(root)).resolves.toBeDefined()));
  });

  it('accepts complete Radar scoring evidence', async () => {
    const root = await createRadarSeedRoot();

    await expect(loadFixtureCatalog(root)).resolves.toMatchObject({
      radar: [
        {
          evidence_signals: ['signal-example'],
          reasoning: 'Example editorial reasoning',
        },
      ],
    });
  });

  it('rejects missing or blank Radar evidence fields', async () => {
    const emptyEvidenceRoot = await createRadarSeedRoot({ evidenceSignals: [] });
    const blankReasoningRoot = await createRadarSeedRoot({ reasoning: '   ' });

    await expect(loadFixtureCatalog(emptyEvidenceRoot)).rejects.toThrow();
    await expect(loadFixtureCatalog(blankReasoningRoot)).rejects.toThrow();
  });

  it('rejects non-HTTPS Signal source URLs', async () => {
    const root = await createRadarSeedRoot({ sourceUrl: 'http://example.com/signal' });

    await expect(loadFixtureCatalog(root)).rejects.toThrow();
  });

  it('rejects a Signal URL outside its Source host allowlist', async () => {
    const root = await createRadarSeedRoot({ sourceUrl: 'https://unrelated.example/signal' });

    await expect(loadFixtureCatalog(root)).rejects.toThrow(
      'Unexpected source URL host unrelated.example in signal-example',
    );
  });

  it('rejects missing or duplicate Radar evidence references', async () => {
    const missingRoot = await createRadarSeedRoot({ evidenceSignals: ['signal-missing'] });
    const duplicateRoot = await createRadarSeedRoot({
      evidenceSignals: ['signal-example', 'signal-example'],
    });

    await expect(loadFixtureCatalog(missingRoot)).rejects.toThrow(
      'Unknown Radar evidence signal signal-missing in radar-example',
    );
    await expect(loadFixtureCatalog(duplicateRoot)).rejects.toThrow(
      'Duplicate Radar evidence signal signal-example in radar-example',
    );
  });

  it('rejects ineligible or wrong-Topic Radar evidence', async () => {
    const ineligibleRoot = await createRadarSeedRoot({ signalStatus: 'inbox' });
    const wrongTopicRoot = await createRadarSeedRoot({ signalTopics: [] });

    await expect(loadFixtureCatalog(ineligibleRoot)).rejects.toThrow(
      'Ineligible Radar evidence signal signal-example in radar-example',
    );
    await expect(loadFixtureCatalog(wrongTopicRoot)).rejects.toThrow(
      'Radar evidence signal signal-example does not reference topic-example in radar-example',
    );
  });

  it('rejects evidence that occurred or was captured after the Radar snapshot', async () => {
    const futureOccurrenceRoot = await createRadarSeedRoot({
      occurredAt: '2026-08-28T00:00:00Z',
    });
    const futureCaptureRoot = await createRadarSeedRoot({
      capturedAt: '2026-08-28T00:00:00Z',
    });

    await expect(loadFixtureCatalog(futureOccurrenceRoot)).rejects.toThrow(
      'Future Radar evidence occurrence signal-example in radar-example',
    );
    await expect(loadFixtureCatalog(futureCaptureRoot)).rejects.toThrow(
      'Future Radar evidence capture signal-example in radar-example',
    );
  });

  it('compares Radar evidence dates in UTC rather than the source offset', async () => {
    const sameUtcDateRoot = await createRadarSeedRoot({
      occurredAt: '2026-08-28T00:30:00+14:00',
    });
    const futureUtcDateRoot = await createRadarSeedRoot({
      occurredAt: '2026-08-27T23:30:00-02:00',
    });

    await expect(loadFixtureCatalog(sameUtcDateRoot)).resolves.toBeDefined();
    await expect(loadFixtureCatalog(futureUtcDateRoot)).rejects.toThrow(
      'Future Radar evidence occurrence signal-example in radar-example',
    );
  });
});
