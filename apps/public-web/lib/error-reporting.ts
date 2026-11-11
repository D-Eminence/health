import { startErrorReporting, type ErrorReporter } from '@hid/observability'
import { getEnvironment } from './env'

/**
 * Error reporting for the public site (owner's approval, 2026-11-03). It starts only when the build carries
 * NEXT_PUBLIC_HID_SENTRY_DSN; without one there is no listener and no request. A report holds the error's type, its
 * stack, the route name and the build (NEXT_PUBLIC_HID_BUILD), nothing else: see @hid/observability's
 * errorReporting.ts. app/ErrorReporting.tsx starts it once from the root layout; app/error.tsx reports what it shows.
 */

let active: ErrorReporter | null = null

/** Starts reporting when a DSN is configured, and returns what stops it. */
export function startSiteErrorReporting(): () => void {
  let environment
  try {
    environment = getEnvironment()
  } catch {
    return () => {}
  }
  if (environment.sentryDsn === null) return () => {}
  const reporter = startErrorReporting({
    dsn: environment.sentryDsn,
    build: environment.build ?? 'unknown',
    environment: environment.name,
    currentPath: () => window.location.pathname,
  })
  if (reporter === null) return () => {}
  active = reporter
  return () => {
    reporter.stop()
    if (active === reporter) active = null
  }
}

/** Reports an error a page's error boundary caught. Nothing happens while reporting is off. */
export function reportSiteError(error: unknown): void {
  active?.report(error, 'react')
}
