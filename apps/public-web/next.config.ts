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
  transpilePackages: ['@hid/api', '@hid/config', '@hid/contracts', '@hid/http', '@hid/observability'],

  // The browser reaches the Health ID Gateway directly over CORS; this app has
  // no server-side proxy and holds no credentials of its own.
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
