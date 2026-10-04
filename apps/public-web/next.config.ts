import type { NextConfig } from 'next'

/**
 * The public site.
 *
 * Next.js is used here because this application benefits from it: server
 * rendering and static generation for pages that must be fast, crawlable and
 * cacheable at the edge. That reasoning does not extend to the authenticated
 * applications, which render private data per session and gain nothing from
 * pre-rendering — they stay on Vite. Framework choice follows the workload.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Workspace packages ship TypeScript source rather than a build step.
  transpilePackages: ['@hid/api', '@hid/config', '@hid/contracts', '@hid/http', '@hid/observability', '@hid/ui'],

  // Local development exposes the gateway under the public site's origin.
  // Production routing is supplied by the deployment's frontend worker.
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return []
    const target = process.env.HID_LOCAL_GATEWAY_ORIGIN ?? 'http://localhost:3000'
    const url = new URL(target)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.protocol !== 'http:' || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('HID_LOCAL_GATEWAY_ORIGIN must be an HTTP localhost origin.')
    }
    return [{ source: '/api/v1/:path*', destination: `${url.origin}/api/v1/:path*` }]
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
