import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Forum, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google'
import { getEnvironment } from '@/lib/env'
import './globals.css'

/**
 * Typefaces are self-hosted through next/font: the files are served from this
 * origin, so no request leaves for a font CDN and there is no layout shift
 * while a face loads.
 *
 * `Forum` is the display face from the approved design. `IBM_Plex_Sans` stands
 * in for Inter at the same metrics and weights — swap the import when the
 * licensed interface face is confirmed; every consumer reads the CSS variable,
 * not the family name.
 */
const forum = Forum({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-forum',
  display: 'swap',
})

const inter = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Health ID — One health identity, every connected provider',
    template: '%s — Health ID',
  },
  description:
    'One Health ID connects a patient’s records across hospitals, laboratories and pharmacies — accessible to providers only with the patient’s consent.',
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
    <html lang="en" className={`${forum.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-surface font-sans text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:rounded-(--radius-control) focus:bg-brand focus:px-5 focus:py-3 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
