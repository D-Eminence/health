import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from '@hid/ui'
import { App } from './App'
import { AppErrorBoundary } from './AppErrorBoundary'
import { rootErrorOptions, startPortalErrorReporting } from './errorReporting'
import { listenForInstallPrompt } from './installPrompt'
import '@fontsource-variable/figtree'
import './index.css'
import { applySavedTheme } from './kasuwa/interactive'
import { takeSwitchArrival } from './siteSwitch'
import { offlineShellHere } from './productHostname'

// Error reports, only when the build carries a DSN (docs/STAGING_DEPLOYMENT.md): without one, nothing listens or sends.
// Started first, so an error in the rest of the start-up is heard too.
const errorReporter = startPortalErrorReporting()

applySavedTheme()

// A switch from another staff site (siteSwitch.ts): its `from` and `back` leave the address before the router reads it,
// and the way back stays in memory. Nothing happens unless the build turns single sign-on on.
takeSwitchArrival()

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

// Outreach with no signal: on Health ID Outreach's own site only, the worker that keeps the app for a reload with no
// signal (outreachShell.ts), loaded as a chunk of its own so no other site downloads it.
if (offlineShellHere(window.location.hostname)) void import('./outreachShell').then(shell => shell.startOutreachShell(), () => undefined)

// The browser offers installing once, soon after the page loads: kept for the Notifications page's "Install the Health ID app".
listenForInstallPrompt(window)

createRoot(container, rootErrorOptions(errorReporter)).render(
  <StrictMode>
    {/* A page that fails to render shows "Something went wrong" and Reload, never a blank screen. */}
    <AppErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
