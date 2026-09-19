import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [resolve(root, 'workers/signal-generation.ts')],
  outfile: resolve(root, '.generation-worker/worker.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['pg-native'],
  plugins: [
    {
      name: 'standalone-server-only',
      setup(builder) {
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: 'server-only',
          namespace: 'empty',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }));
      },
    },
  ],
});
