import { Component, type ReactNode } from 'react'
import { EhrButton } from '@hid/ui/ehr'
import { focusLost } from '../../pageFocus'

interface BluePageBoundaryProps {
  readonly children: ReactNode
  /** What Reload does: the page's own reload, unless a test says otherwise. */
  readonly reload?: () => void
}

/**
 * What a blue page that fails to render leaves, inside the frame: the sidebar, the top bar and the account menu stay,
 * so staff can go elsewhere. Its words are today's app's when a page fails (AppErrorBoundary: "Something went wrong",
 * "This page could not be shown. Reload it to try again.", Reload, "Go to your overview"; parity report 3.3-52), and,
 * like it, it shows nothing of the failure, whose message may hold anything the page held. Its way to the overview is
 * the provider overview, Home, where AppErrorBoundary's leads to the site's root. The frame gives it the page's address
 * as its key, so going to another page tries again.
 */
export class BluePageBoundary extends Component<BluePageBoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  /** In the commit that shows the message: the control that had focus went with the page. */
  private readonly focusHeading = (heading: HTMLHeadingElement | null) => { if (heading && focusLost()) heading.focus() }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="hid-ehr-blue-failed">
        <div className="hid-ehr-page-heading">
          <div className="hid-ehr-page-heading-text">
            <h1 ref={this.focusHeading} tabIndex={-1} className="hid-ehr-page-title">Something went wrong</h1>
          </div>
        </div>
        <p className="hid-ehr-blue-flush">This page could not be shown. Reload it to try again.</p>
        <div className="hid-ehr-actions">
          <EhrButton onClick={() => { if (this.props.reload) this.props.reload(); else window.location.reload() }}>Reload</EhrButton>
          <EhrButton variant="secondary" onClick={() => { window.location.assign('/provider') }}>Go to your overview</EhrButton>
        </div>
      </div>
    )
  }
}
