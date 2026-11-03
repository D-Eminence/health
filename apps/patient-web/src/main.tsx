import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from '@hid/ui'
import { App } from './App'
import { AppErrorBoundary } from './AppErrorBoundary'
import { listenForInstallPrompt } from './installPrompt'
import '@fontsource-variable/figtree'
import './index.css'
import { applySavedTheme } from './kasuwa/interactive'
import { takeSwitchArrival } from './siteSwitch'

applySavedTheme()

// A switch from another staff site (siteSwitch.ts): its `from` and `back` leave the address before the router reads it,
// and the way back stays in memory. Nothing happens unless the build turns single sign-on on.
takeSwitchArrival()

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

// The browser offers installing once, soon after the page loads: kept for the Notifications page's "Install the Health ID app".
listenForInstallPrompt(window)

createRoot(container).render(
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
