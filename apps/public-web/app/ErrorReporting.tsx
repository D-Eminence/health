'use client'

import { useEffect } from 'react'
import { startSiteErrorReporting } from '@/lib/error-reporting'

/**
 * Starts error reporting once the page is interactive, and only when the build carries a DSN (lib/error-reporting.ts).
 * Rendered once, by the root layout. It renders nothing.
 */
export function ErrorReporting() {
  useEffect(() => startSiteErrorReporting(), [])
  return null
}
