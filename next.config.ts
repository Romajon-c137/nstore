import type { NextConfig } from 'next'
import legacyRedirects from './migration/next-redirects.json'

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['127.0.0.1'],
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  turbopack: { root: process.cwd() },
  async redirects() { return legacyRedirects },
  async rewrites() {
    const origin = (process.env.DJANGO_API_ORIGIN || 'http://127.0.0.1:8000').replace(/\/$/, '')
    return [
      { source: '/api/v1/:path*', destination: `${origin}/api/v1/:path*/` },
      { source: '/media/:path*', destination: `${origin}/media/:path*` },
    ]
  },
}
export default config
