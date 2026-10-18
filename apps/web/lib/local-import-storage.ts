import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink, link } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isLocalDevelopment } from './local-development.ts';
import { ImportIOError } from './import-io.ts';
import { originalExpired } from '../../../packages/ingestion/src/import-retention.mjs';

const maximumSize = 25 * 1024 * 1024;
const pathPattern =
  /^imports\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Environment = Readonly<Record<string, string | undefined>>;
const conflict = () => new ImportIOError('document_conflict');
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

async function privateDirectory(path: string, create: boolean) {
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
    throw conflict();
}

async function objectPath(key: string, env: Environment, create = false) {
  if (!isLocalDevelopment(env)) throw new ImportIOError('not_configured');
  const state = env.HZENSE_LOCAL_STATE_DIR;
  if (!state || !isAbsolute(state) || basename(state) !== '.hzense-local' || !pathPattern.test(key))
    throw new ImportIOError('invalid_request');
  await privateDirectory(state, false);
  const directory = join(state, 'import-originals');
  await privateDirectory(directory, create);
  return join(directory, createHash('sha256').update(key).digest('hex'));
}

async function readObject(path: string, key: string, allowExpired: boolean) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error) => {
    if (missing(error)) throw new ImportIOError('source_unavailable');
    throw conflict();
  });
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > maximumSize + 2048 ||
      stat.size < 5
    )
      throw conflict();
    const packed = await file.readFile();
    const length = packed.readUInt32BE(0);
    if (length > 2048 || length < 1 || 4 + length >= packed.length) throw conflict();
    const receipt = JSON.parse(packed.subarray(4, 4 + length).toString('utf8'));
    const bytes = packed.subarray(4 + length);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (
      receipt.key !== key ||
      receipt.sha256 !== sha256 ||
      receipt.size !== bytes.length ||
      bytes.length > maximumSize ||
      !Number.isSafeInteger(receipt.uploadedAt)
    )
      throw conflict();
    if (!allowExpired && originalExpired(receipt.uploadedAt))
      throw new ImportIOError('source_expired');
    return { bytes, sha256, version: `sha256-${sha256}`, stat };
  } catch (error) {
    if (error instanceof ImportIOError) throw error;
    throw conflict();
  } finally {
    await file.close();
  }
}

/** Private immutable envelope; browser-supplied filenames never become filesystem paths. */
export async function putLocalImportObject(
  key: string,
  bytes: Buffer,
  env: Environment = process.env,
) {
  if (bytes.length < 1 || bytes.length > maximumSize) throw new ImportIOError('limit_exceeded');
  const path = await objectPath(key, env, true);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const header = Buffer.from(
    JSON.stringify({ key, sha256, size: bytes.length, uploadedAt: Date.now() }),
  );
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(header.length);
  const temporary = join(dirname(path), `.pending-${randomUUID()}`);
  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(Buffer.concat([prefix, header, bytes]));
    await file.sync();
    await file.close();
    try {
      // Atomic create-if-absent. Never overwrite a receipt from another upload.
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readObject(path, key, false);
      if (existing.sha256 !== sha256) throw conflict();
    }
  } finally {
    await file.close().catch(() => {});
    await unlink(temporary).catch((error) => {
      if (!missing(error)) throw error;
    });
  }
  return { version: `sha256-${sha256}`, sha256 };
}

export async function readLocalImportObject(key: string, env: Environment = process.env) {
  let path: string;
  try {
    path = await objectPath(key, env);
  } catch (error) {
    if (missing(error)) throw new ImportIOError('source_unavailable');
    throw error;
  }
  const { bytes, sha256, version } = await readObject(path, key, false);
  return { bytes, sha256, version };
}

export async function removeLocalImportObject(key: string, env: Environment = process.env) {
  try {
    const path = await objectPath(key, env);
    const { stat } = await readObject(path, key, true);
    const current = await lstat(path);
    if (current.isSymbolicLink() || current.ino !== stat.ino || current.dev !== stat.dev)
      throw conflict();
    await unlink(path);
  } catch (error) {
    if (missing(error) || (error instanceof ImportIOError && error.code === 'source_unavailable'))
      return;
    throw error;
  }
}
