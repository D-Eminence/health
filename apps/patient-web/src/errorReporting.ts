import type { RootOptions } from 'react-dom/client'
import { startErrorReporting, type ErrorReporter } from '@hid/observability'
import { getEnvironment } from './env'

/**
 * Error reporting for the portal (owner's approval, 2026-11-03). It starts only when the build carries
 * VITE_HID_SENTRY_DSN; without one there is no listener and no request. A report holds the error's type, its stack,
 * the route name and the build (VITE_HID_BUILD), nothing else: see @hid/observability's errorReporting.ts.
 */
export function startPortalErrorReporting(): ErrorReporter | null {
  let environment
  try {
    environment = getEnvironment()
  } catch {
    // A build with incomplete configuration shows its own failure where the portal reads it; reporting stays off.
    return null
  }
  if (environment.sentryDsn === null) return null
  return startErrorReporting({
    dsn: environment.sentryDsn,
    build: environment.build ?? 'unknown',
    environment: environment.name,
    currentPath: () => window.location.pathname,
  })
}

/**
 * The React root's error handlers. Without a reporter, none: React keeps its own. With one, each error React meets
 * (one an error boundary such as AppErrorBoundary caught, or one no boundary caught) is reported, and React's own
 * handling of it still follows.
 */
export function rootErrorOptions(reporter: ErrorReporter | null): RootOptions {
  if (reporter === null) return {}
  return {
    onCaughtError: error => {
      reporter.report(error, 'react')
      // React's default for a caught error (react-dom's defaultOnCaughtError), which passing onCaughtError replaces.
      // eslint-disable-next-line no-restricted-syntax -- the same console line React writes without these handlers
      console.error(error)
    },
    onUncaughtError: error => {
      reporter.report(error, 'react')
      // React's default for an uncaught error: the browser's own report, which the reporter hears too and does not
      // send twice (one report per type and place).
      if (typeof globalThis.reportError === 'function') globalThis.reportError(error)
      // eslint-disable-next-line no-restricted-syntax -- React's fallback where the browser has no reportError
      else console.error(error)
    },
  }
}
