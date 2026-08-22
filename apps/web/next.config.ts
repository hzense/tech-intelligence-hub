import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@hzense/content'],
};

export default nextConfig;
