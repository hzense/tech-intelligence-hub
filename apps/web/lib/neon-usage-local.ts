import { constants } from 'node:fs';
import { link, lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, isAbsolute, join, resolve } from 'node:path';
import {
  NeonUsageError,
  neonUsageByteLimit,
  neonUsageHistoryLimit,
  neonUsageProjectId,
  neonUsageRetentionDays,
  neonUsageSampleInterval,
  parseNeonUsageHistory,
  type NeonUsageHistory,
  type NeonUsageSample,
} from './neon-usage-core.ts';
import type { NeonUsageStore } from './neon-usage-service.ts';

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const bucket = (sample: NeonUsageSample) =>
  Math.floor(Date.parse(sample.sampledAt) / neonUsageSampleInterval);
const sameSample = (a: NeonUsageSample, b: NeonUsageSample) =>
  a.sampledAt === b.sampledAt &&
  a.bytes === b.bytes &&
  a.periodStart === b.periodStart &&
  a.periodEnd === b.periodEnd &&
  JSON.stringify(a.costs ?? null) === JSON.stringify(b.costs ?? null);

/** Immutable slots commute across processes; crashed temporary writes cannot hold a lock. */
export function createNeonUsageLocalStore(
  projectId: string,
  stateDirectory: string,
): NeonUsageStore {
  if (
    !neonUsageProjectId(projectId) ||
    !isAbsolute(stateDirectory) ||
    basename(stateDirectory) !== '.hzense-local'
  )
    throw new NeonUsageError('not_configured');
  const parent = join(stateDirectory, 'neon-usage');
  const directory = join(parent, projectId);
  async function checkDirectory(path: string, create = false) {
    if (create)
      await mkdir(path, { mode: 0o700 }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      });
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.() ||
      (await realpath(path)) !== resolve(/* turbopackIgnore: true */ path)
    )
      throw new NeonUsageError('storage_unavailable');
  }
  async function prepare(create = false) {
    await checkDirectory(stateDirectory);
    await checkDirectory(parent, create);
    await checkDirectory(directory, create);
  }
  async function readSample(name: string) {
    const file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      // Atomic link publishes the complete file before its .pending alias is removed.
      // A second link is valid in that brief window or after a crash at that point.
      if (
        !stat.isFile() ||
        stat.nlink < 1 ||
        stat.nlink > 2 ||
        stat.size > 4096 ||
        (stat.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid?.()
      )
        throw new NeonUsageError('storage_unavailable');
      const data = await file.readFile();
      const parsed = parseNeonUsageHistory(JSON.parse(data.toString('utf8')), projectId);
      const sample = parsed.samples[0];
      if (parsed.samples.length !== 1 || !sample || `${bucket(sample)}.json` !== name)
        throw new NeonUsageError('storage_unavailable');
      return { sample, size: data.byteLength, stat };
    } finally {
      await file.close();
    }
  }
  async function snapshot() {
    await prepare();
    const samples: NeonUsageSample[] = [];
    const files: Array<{ name: string; sample: NeonUsageSample }> = [];
    let entries = 0,
      bytes = 0;
    const handle = await opendir(directory);
    for await (const entry of handle) {
      // Bound even directories containing unexpected user-created files.
      if (++entries > neonUsageHistoryLimit * 2) throw new NeonUsageError('storage_unavailable');
      if (!/^(?:0|[1-9]\d{0,15})\.json$/.test(entry.name)) continue;
      if (files.length >= neonUsageHistoryLimit) throw new NeonUsageError('storage_unavailable');
      let value;
      try {
        value = await readSample(entry.name);
      } catch (error) {
        // Another sampler may prune an expired slot while this reader walks the directory.
        if (missing(error)) continue;
        throw error;
      }
      bytes += value.size;
      if (bytes > neonUsageByteLimit) throw new NeonUsageError('storage_unavailable');
      samples.push(value.sample);
      files.push({ name: entry.name, sample: value.sample });
    }
    const history = parseNeonUsageHistory({ version: 1, projectId, samples }, projectId);
    return {
      history,
      files,
      bytes,
      version: createHash('sha256').update(JSON.stringify(history)).digest('hex'),
    };
  }
  const store: NeonUsageStore = {
    async read() {
      try {
        const saved = await snapshot();
        return saved.history.samples.length
          ? { history: saved.history, version: saved.version }
          : null;
      } catch (error) {
        if (missing(error)) return null;
        throw new NeonUsageError('storage_unavailable');
      }
    },
    async compareAndSwap(value, version) {
      try {
        const proposed = parseNeonUsageHistory(value, projectId);
        await prepare(true);
        const saved = await snapshot();
        if ((saved.history.samples.length ? saved.version : null) !== version) return false;
        const slots = new Map(saved.history.samples.map((sample) => [bucket(sample), sample]));
        const additions = proposed.samples.filter((sample) => !slots.has(bucket(sample)));
        // Existing counters are immutable, even when the caller has the latest version.
        if (
          additions.length !== 1 ||
          proposed.samples.some((sample) => {
            const existing = slots.get(bucket(sample));
            return existing && !sameSample(sample, existing);
          })
        )
          return false;
        const sample = additions[0];
        if (!sample) return false;
        const packed: NeonUsageHistory = { version: 1, projectId, samples: [sample] };
        const body = JSON.stringify(packed);
        if (
          Buffer.byteLength(body) + saved.bytes > neonUsageByteLimit ||
          saved.history.samples.length >= neonUsageHistoryLimit
        )
          throw new NeonUsageError('storage_unavailable');
        const temporary = join(directory, `.pending-${randomUUID()}`);
        const target = join(directory, `${bucket(sample)}.json`);
        const file = await open(
          temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await file.writeFile(body);
          await file.sync();
          await file.close();
          try {
            await link(temporary, target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
            throw error;
          }
        } finally {
          await file.close().catch(() => {});
          await unlink(temporary).catch((error) => {
            if (!missing(error)) throw error;
          });
        }
        // Retain a rolling 60 days relative to the latest successful sample.
        // Delete only validated, unchanged expired slots, never unknown/pending files.
        const latest = Math.max(
          Date.parse(sample.sampledAt),
          ...saved.history.samples.map((s) => Date.parse(s.sampledAt)),
        );
        const cutoff = latest - neonUsageRetentionDays * 86_400_000;
        for (const entry of saved.files) {
          if (Date.parse(entry.sample.sampledAt) >= cutoff) continue;
          try {
            const current = await readSample(entry.name);
            const path = join(directory, entry.name);
            const stat = await lstat(path);
            if (
              sameSample(current.sample, entry.sample) &&
              !stat.isSymbolicLink() &&
              stat.ino === current.stat.ino &&
              stat.dev === current.stat.dev
            )
              await unlink(path);
          } catch (error) {
            if (!missing(error)) throw error;
          }
        }
        return true;
      } catch (error) {
        if (error instanceof NeonUsageError) throw error;
        throw new NeonUsageError('storage_unavailable');
      }
    },
  };
  return store;
}
