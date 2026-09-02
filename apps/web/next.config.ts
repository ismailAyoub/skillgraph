import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@skillgraph/core'],
  reactStrictMode: true,
};

export default nextConfig;
