import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { parse } from 'yaml';
import { expect, it } from 'vitest';

it('keeps the YAML library but excludes its unused vulnerable CLI dependency chain', async () => {
  const lock = parse(await readFile(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8'));
  expect(lock.snapshots['js-yaml@3.15.2']).toBeDefined();
  expect(lock.snapshots['js-yaml@3.15.2'].dependencies).not.toHaveProperty('argparse');
  for (const section of ['packages', 'snapshots']) {
    expect(Object.keys(lock[section]).some((id) => id.startsWith('sprintf-js@'))).toBe(false);
    expect(lock[section]['source-map-js@1.2.1']).toBeUndefined();
    expect(lock[section]['source-map-js@1.2.2']).toBeDefined();
  }
});

it('parses and serializes real gray-matter YAML without argparse, sprintf-js or network access', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict';
        import { registerHooks } from 'node:module';
        import { Socket } from 'node:net';
        let forbiddenLoads = 0;
        let networkCalls = 0;
        const offline = () => {
          networkCalls++;
          throw Error('Frontmatter dependency test must stay offline');
        };
        globalThis.fetch = offline;
        Socket.prototype.connect = offline;
        const hooks = registerHooks({
          resolve(specifier, context, nextResolve) {
            if (['argparse', 'sprintf-js'].some(
              (name) => specifier === name || specifier.startsWith(name + '/'),
            )) {
              forbiddenLoads++;
              throw Error('Unused CLI dependency requested: ' + specifier);
            }
            return nextResolve(specifier, context);
          },
        });
        try {
          const { default: matter } = await import('gray-matter');
          const data = { title: '技术洞察', topics: ['ai-safety', 'models'], published: true };
          const serialized = matter.stringify('正文内容', data);
          const parsed = matter(serialized);
          assert.deepEqual(parsed.data, data);
          assert.equal(parsed.content.trim(), '正文内容');
          assert.throws(() => matter('---\\nbroken: [\\n---\\n正文'), /YAML|flow collection|end of the stream/);
          assert.equal(forbiddenLoads, 0);
          assert.equal(networkCalls, 0);
        } finally {
          hooks.deregister();
        }
      `,
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 128 * 1024,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stderr || result.stdout).toBe(0);
});
