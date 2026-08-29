import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildDailyDraftRequest, renderDailyDraft, selectDailyCandidates } from './daily.js';
import { loadContent } from './loader.js';
import { loadSeedCatalog } from './seed.js';

const args = process.argv.slice(2);

function argument(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

async function writeOutputs(values: Record<string, string>): Promise<void> {
  const githubOutput = argument('--github-output');
  if (!githubOutput) return;
  await appendFile(
    githubOutput,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
    'utf8',
  );
}

async function main(): Promise<void> {
  const date = argument('--date');
  if (!date) throw new Error('--date is required');

  const contentRoot = resolve(process.cwd(), '../../content');
  const seedRoot = resolve(process.cwd(), '../../data/seed');
  const outputRoot = resolve(argument('--output-root') ?? resolve(process.cwd(), '../..'));
  const manifestPath = argument('--manifest') ? resolve(argument('--manifest')!) : undefined;
  const baseSha = argument('--base-sha') ?? 'local';
  const request = buildDailyDraftRequest(date);
  const [catalog, entries] = await Promise.all([
    loadSeedCatalog(seedRoot),
    loadContent({ contentRoot, seedRoot }),
  ]);

  const existing = entries.find(
    (entry) => entry.frontMatter.type === 'daily' && entry.frontMatter.date === date,
  );
  if (existing) {
    await writeOutputs({ changed: 'false', date, reason: 'daily_exists' });
    console.log(
      `Daily ${date} already exists at ${existing.relativePath}; refusing to overwrite it.`,
    );
    return;
  }

  const usedSignalIds = new Set(
    entries.flatMap((entry) =>
      entry.frontMatter.type === 'daily' ? entry.frontMatter.signal_refs : [],
    ),
  );
  const selection = selectDailyCandidates(catalog, request, usedSignalIds);
  if (selection.signals.length === 0) {
    await writeOutputs({
      changed: 'false',
      date,
      eligible_signals: String(selection.diagnostics.eligibleSignals),
      reason: 'no_candidates',
    });
    console.log(`No eligible Daily signals for ${date}; no candidate was written.`);
    return;
  }

  const relativePath = `content/daily/${date.slice(0, 4)}/${date}.md`;
  const outputPath = join(outputRoot, relativePath);
  const bytes = renderDailyDraft(selection);
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await writeFile(outputPath, bytes, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code !== 'EEXIST') throw error;
    const existingBytes = await readFile(outputPath, 'utf8');
    if (existingBytes !== bytes)
      throw new Error(`Refusing to overwrite changed candidate ${outputPath}`);
    await writeOutputs({ changed: 'false', date, reason: 'candidate_unchanged' });
    console.log(`Daily candidate ${relativePath} is unchanged.`);
    return;
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (manifestPath) {
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          base_sha: baseSha,
          cutoff_at: request.cutoffAt,
          date,
          relative_path: relativePath,
          selected_signal_ids: selection.signals.map((signal) => signal.id),
          sha256,
          version: 1,
          window_start_at: request.windowStartAt,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
  await writeOutputs({
    changed: 'true',
    date,
    eligible_signals: String(selection.diagnostics.eligibleSignals),
    relative_path: relativePath,
    selected_signals: String(selection.signals.length),
    sha256,
  });
  console.log(
    `Created deterministic Daily candidate ${relativePath} with ${selection.signals.length} signals.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
