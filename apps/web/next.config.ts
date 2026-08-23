import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const webRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(webRoot, '../..');
const contentTrace = ['../../content/**/*', '../../data/seed/*.yaml'];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@hzense/content'],
  outputFileTracingRoot: repositoryRoot,
  outputFileTracingIncludes: {
    '/': contentTrace,
    '/daily': contentTrace,
    '/daily/[date]': contentTrace,
  },
};

export default nextConfig;
