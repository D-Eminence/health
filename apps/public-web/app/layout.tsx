import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Forum, Inter } from 'next/font/google'
import { getEnvironment } from '@/lib/env'
import { GlobalSearchProvider } from '@/components/layout/GlobalSearch'
import { FeedbackProvider } from '@/components/shared/FeedbackProvider'
import './globals.css'

/**
 * Typefaces are self-hosted through next/font: the files are served from this
 * origin, so no request leaves for a font CDN and there is no layout shift
 * while a face loads.
 *
 * `Forum` is the display face from the approved design and `Inter` is used for
 * navigation, body copy and interface controls. Every consumer reads the CSS
 * variables rather than a hard-coded family name.
 */
const forum = Forum({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-forum',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
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
