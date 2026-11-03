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

// Error reports, only when the build carries a DSN (docs/STAGING_DEPLOYMENT.md): without one, nothing listens or sends.
// Started first, so an error in the rest of the start-up is heard too.
const errorReporter = startPortalErrorReporting()

applySavedTheme()

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

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
