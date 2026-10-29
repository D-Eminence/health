import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from '@hid/ui'
import { App } from './App'
import { AppErrorBoundary } from './AppErrorBoundary'
import { listenForInstallPrompt } from './installPrompt'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

// The browser offers installing once, soon after the page loads: kept for the Notifications page's "Install the Health ID app".
listenForInstallPrompt(window)

// Offline-first kill switch (docs/OFFLINE-CONTRACT.md 2.3): a build with offline off for this host asks a worker
// already on this device to delete its saved app shell. Loaded on its own, so the entry chunk stays free of the
// service worker API.
if (import.meta.env.VITE_HID_OFFLINE_MODE !== 'pilot' && import.meta.env.VITE_HID_OFFLINE_MODE !== 'on') {
  void import('./offline/shell').then(shell => shell.purgeShellWhenOff()).catch(() => undefined)
}

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
