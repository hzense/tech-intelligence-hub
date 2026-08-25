import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const webRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(webRoot, '../..');
const contentTrace = ['../../content/**/*', '../../data/seed/*.yaml'];
const securityHeaders = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  poweredByHeader: false,
  transpilePackages: ['@hzense/content'],
  outputFileTracingRoot: repositoryRoot,
  outputFileTracingIncludes: {
    '/': contentTrace,
    '/daily': contentTrace,
    '/daily/[date]': contentTrace,
    '/insights': contentTrace,
    '/insights/[id]': contentTrace,
    '/topics': contentTrace,
    '/topics/[id]': contentTrace,
    '/sitemap.xml': contentTrace,
  },
};

export default nextConfig;
