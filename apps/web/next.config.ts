import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  // `NEXT_DIST_DIR=.next-verify pnpm build` verifies a production build without touching a running dev server's .next
  distDir: process.env['NEXT_DIST_DIR'] || '.next',
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  // the shared package exports TypeScript source
  transpilePackages: ['@school-sync/shared'],
  // Docker image: BUILD_STANDALONE=1 pnpm build → .next/standalone (monorepo-aware tracing below)
  output: process.env['BUILD_STANDALONE'] === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // *.localhost sub-domains (demo.localhost:3000) are first-class in dev
  allowedDevOrigins: ['*.localhost', 'localhost', '127.0.0.1'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'motion', 'date-fns'],
    // the BFF proxy buffers request bodies; Next's default (10 MiB) is below the API's 15 MiB upload limit
    proxyClientMaxBodySize: '16mb',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
