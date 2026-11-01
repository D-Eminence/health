import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import localFont from 'next/font/local'
import { getEnvironment } from '@/lib/env'
import { GlobalSearchProvider } from '@/components/layout/GlobalSearch'
import { FeedbackProvider } from '@/components/shared/FeedbackProvider'
import './globals.css'
import { SupportWidget } from './SupportWidget'

/**
 * Typefaces are self-hosted through next/font: the files are served from this
 * origin, so no request leaves for a font CDN.
 *
 * The files are committed in app/fonts (latin subset, with their licences;
 * app/fonts/README.md says where each came from), so the build reads them
 * from the repo. next/font/google downloaded them from Google at build time,
 * and that download intermittently failed the build. They are the same files
 * it downloaded, so visitors see no change.
 *
 * `Forum` is the display face from the approved design, used for the About
 * page's approach labels. `Inter` sets the product illustrations: the sample
 * dashboards' headings and figures, and the Preview tag in the patient
 * access-request example. The site's running text uses --font-sans from
 * @hid/ui. Every consumer reads the CSS variables rather than a hard-coded
 * family name. While a face loads, the page shows Arial adjusted to that
 * face's metrics (as next/font/google chose for both), which keeps the layout
 * shift small when the face swaps in.
 */
const forum = localFont({
  src: './fonts/forum/forum-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-forum',
  display: 'swap',
  adjustFontFallback: 'Arial',
})

// One variable file serves all three weights, as Google's own stylesheet did.
// Declaring it at exactly 400, 500 and 600, rather than as a 400-600 range,
// keeps how other weights resolve: a 550 or 650 rule renders at 600, as before.
const inter = localFont({
  src: [
    { path: './fonts/inter/inter-latin-wght-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/inter/inter-latin-wght-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/inter/inter-latin-wght-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-inter',
  display: 'swap',
  adjustFontFallback: 'Arial',
})

export const metadata: Metadata = {
  title: {
    default: 'Health ID: One health identity, every connected provider',
    template: '%s | Health ID',
  },
  description:
    'One Health ID connects a patient’s records across hospitals, laboratories and pharmacies. Providers access them only with the patient’s consent.',
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // Resolving configuration in the layout means a misconfigured deployment
  // fails at build time, on every page, rather than on whichever route
  // happened to need the gateway first.
  getEnvironment()

  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${forum.variable} ${inter.variable}`}>
      <body className="bg-surface font-sans text-ink antialiased">
        <SupportWidget />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:rounded-(--radius-control) focus:bg-brand focus:px-5 focus:py-3 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        <FeedbackProvider>
          <GlobalSearchProvider>{children}</GlobalSearchProvider>
        </FeedbackProvider>
      </body>
    </html>
  )
}
