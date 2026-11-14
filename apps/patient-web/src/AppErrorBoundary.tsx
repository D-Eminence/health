import { Component, type ReactNode } from 'react'
import { BrandLogo } from './BrandLogo'
import { focusLost } from './pageFocus'

/**
 * What a page that fails to render leaves, in place of a blank screen (hid-1.0's App.tsx ErrorBoundary): it says
 * so, and Reload loads the portal again, as a new release's chunk that will not load also needs. Away from the
 * overview a link loads that instead, a full load as the router went with the page: a page that fails each time
 * would otherwise leave the installed app, which has no address bar, nowhere else to go. Nothing about the
 * failure is shown: its message may hold anything the page held.
 */
interface AppErrorBoundaryProps {
  readonly children: ReactNode
  /** What Reload does: the page's own reload, unless a test says otherwise. */
  readonly reload?: () => void
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  /** In the commit that shows the screen: the control that had focus went with the page. */
  private readonly focusHeading = (heading: HTMLHeadingElement | null) => { if (heading && focusLost()) heading.focus() }

  override render() {
    if (!this.state.failed) return this.props.children
    return <main className="patient-page">
      <BrandLogo className="patient-state-logo" />
      <div role="alert" className="patient-access-state">
        <h1 ref={this.focusHeading} tabIndex={-1}>Something went wrong</h1>
        <p>This page could not be shown. Reload it to try again.</p>
        <div className="patient-state-actions">
          <button type="button" className="patient-primary-button" onClick={() => { if (this.props.reload) this.props.reload(); else window.location.reload() }}>Reload</button>
          {window.location.pathname !== '/' && <a className="patient-secondary-button" href="/">Go to your overview</a>}
        </div>
      </div>
    </main>
  }
}
