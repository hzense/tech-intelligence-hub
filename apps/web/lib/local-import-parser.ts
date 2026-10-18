import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { importParserSource } from '../../../packages/ingestion/src/import-parser-source.mjs';
import { isLocalDevelopment } from './local-development.ts';
import { ImportIOError } from './import-io.ts';

export const localImportParserImage = 'hzense-local-import-parser:1';
type Environment = Readonly<Record<string, string | undefined>>;
type Command = (args: string[], input?: Buffer, timeout?: number) => Promise<string>;

/** Only trusted Docker CLI invocations run on the host. Documents never do. */
function commandFor(env: Environment): Command {
  const childEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    ...Object.fromEntries(
      ['PATH', 'HOME', 'TMPDIR', 'LANG'].flatMap((name) => (env[name] ? [[name, env[name]!]] : [])),
    ),
  };
  return (args, input, timeout = 10000) =>
    new Promise((resolve, reject) => {
      const child = spawn('docker', args, {
        env: childEnvironment,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (error?: ImportIOError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          child.kill('SIGKILL');
          reject(error);
        } else resolve(Buffer.concat(chunks).toString('utf8'));
      };
      const timer = setTimeout(() => finish(new ImportIOError('parse_failed')), timeout);
      child.on('error', () => finish(new ImportIOError('not_configured')));
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2000000) finish(new ImportIOError('limit_exceeded'));
        else chunks.push(chunk);
      });
      // Never log untrusted parser errors or Docker account configuration.
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('close', (code) =>
        finish(code === 0 ? undefined : new ImportIOError('parse_failed')),
      );
      child.stdin.end(input);
    });
}

export function localParserArguments(context: string, image: string, name: string) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(context) ||
    !/^sha256:[a-f0-9]{64}$/.test(image) ||
    !/^hzense-parser-[a-f0-9-]{36}$/.test(name)
  )
    throw new ImportIOError('not_configured');
  return [
    '--context',
    context,
    'run',
    '--rm',
    '--interactive',
    '--pull',
    'never',
    '--name',
    name,
    '--label',
    'org.hzense.local-parser=1',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    '32',
    '--memory',
    '1g',
    '--memory-swap',
    '1g',
    '--cpus',
    '1',
    '--user',
    '65532:65532',
    // The Docker CLI reads proxy defaults from HOME/.docker/config.json. Explicit
    // empty overrides prevent proxy URLs/credentials from entering the parser.
    ...[
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
      'FTP_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
      'no_proxy',
      'ftp_proxy',
    ].flatMap((key) => ['--env', `${key}=`]),
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=67108864,mode=1777',
    image,
  ];
}

export async function parseLocalImport(
  bytes: Buffer,
  format: string,
  env: Environment = process.env,
  run: Command = commandFor(env),
) {
  if (!isLocalDevelopment(env)) throw new ImportIOError('not_configured');
  if (!['pdf', 'docx', 'markdown', 'text', 'html', 'csv', 'xlsx'].includes(format))
    throw new ImportIOError('unsupported_content');
  if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024)
    throw new ImportIOError('limit_exceeded');
  const contexts = JSON.parse(await run(['context', 'inspect']));
  const context = contexts?.[0];
  if (
    !Array.isArray(contexts) ||
    contexts.length !== 1 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(context?.Name ?? '') ||
    !/^unix:\/\/\/[^?\r\n]+$/.test(context?.Endpoints?.docker?.Host ?? '')
  )
    throw new ImportIOError('not_configured');
  const images = JSON.parse(
    await run(['--context', context.Name, 'image', 'inspect', localImportParserImage]),
  );
  const image = images?.[0];
  if (
    !Array.isArray(images) ||
    images.length !== 1 ||
    image?.Os !== 'linux' ||
    image?.Config?.Labels?.['org.hzense.local-parser'] !== '1' ||
    image?.Config?.User !== '65532:65532' ||
    JSON.stringify(image?.Config?.Entrypoint) !==
      JSON.stringify(['python3', '-I', '/opt/hzense/import-runner.py']) ||
    Object.keys(image?.Config?.Volumes ?? {}).length !== 0
  )
    throw new ImportIOError('not_configured');
  const name = `hzense-parser-${randomUUID()}`;
  const args = localParserArguments(context.Name, image.Id, name);
  try {
    const raw = await run(
      args,
      Buffer.from(
        JSON.stringify({
          parser: importParserSource,
          format,
          content: bytes.toString('base64'),
        }),
      ),
      125000,
    );
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new ImportIOError('parse_failed');
    }
    if (result?.error)
      throw new ImportIOError(
        ['ocr_required', 'limit_exceeded', 'unsupported_content'].includes(result.error)
          ? result.error
          : 'parse_failed',
      );
    if (!result || !Object.hasOwn(result, 'output')) throw new ImportIOError('parse_failed');
    return result.output;
  } finally {
    // A killed CLI does not kill its container. Remove only our fresh random name.
    await run(['--context', context.Name, 'rm', '--force', name]).catch(() => {});
  }
}
