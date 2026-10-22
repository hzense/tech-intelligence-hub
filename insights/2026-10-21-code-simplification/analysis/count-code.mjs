import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { readFileSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

// Physical lines, including comments and blank lines. Never inspect credentials,
// ignored files, dependencies, generated output, prose or content data.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const extensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.py',
  '.sql',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.sh',
  '.bash',
  '.html',
]);
const included = (path) =>
  extensions.has(extname(path)) &&
  !/^(docs|content|data|datas|insights)\//.test(path) &&
  !/(^|\/)(node_modules|dist|build|coverage|\.next|\.turbo|\.hzense-local|playwright-report|test-results)(\/|$)/.test(
    path,
  );
const git = (args, options = {}) => execFileSync('git', args, { cwd: root, ...options });
const count = (files) => {
  const totals = { files: 0, lines: 0, nonblank: 0, testLines: 0, sourceLines: 0 };
  for (const [path, text] of files) {
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    totals.files++;
    totals.lines += lines.length;
    totals.nonblank += lines.filter((line) => line.trim()).length;
    totals[
      /(^|\/)(test|tests|e2e|__tests__)(\/|$)|\.(test|spec)\.[^/]+$/.test(path)
        ? 'testLines'
        : 'sourceLines'
    ] += lines.length;
  }
  return totals;
};

const args = process.argv.slice(2);
if (args.length > 1) throw new Error('Usage: node count-code.mjs [baseline-commit]');
const baseline = git(['rev-parse', '--verify', `${args[0] ?? '0306a61'}^{commit}`], {
  encoding: 'utf8',
}).trim();
const paths = git(['ls-tree', '-r', '--name-only', '-z', baseline], { encoding: 'utf8' })
  .split('\0')
  .filter(included);
const blobs = git(['cat-file', '--batch'], {
  input: paths.map((path) => `${baseline}:${path}\n`).join(''),
  maxBuffer: 64 * 1024 * 1024,
});
let offset = 0;
const before = paths.map((path) => {
  const end = blobs.indexOf(10, offset);
  const header = blobs.subarray(offset, end).toString('utf8');
  const match = /^[a-f0-9]+ blob (\d+)$/.exec(header);
  if (!match) throw new Error('Unexpected Git blob response');
  const size = Number(match[1]);
  const text = blobs.subarray(end + 1, end + 1 + size).toString('utf8');
  offset = end + size + 2;
  return [path, text];
});
const currentPaths = new Set(
  git(['ls-files', '-c', '-o', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0'),
);
const after = [...currentPaths]
  .filter(included)
  .filter((path) => existsSync(resolve(root, path)))
  .map((path) => [path, readFileSync(resolve(root, path), 'utf8')]);
const previous = count(before),
  current = count(after);
console.log(
  JSON.stringify(
    {
      baseline,
      previous,
      current,
      reduction: Object.fromEntries(
        Object.keys(previous).map((key) => [key, previous[key] - current[key]]),
      ),
    },
    null,
    2,
  ),
);
