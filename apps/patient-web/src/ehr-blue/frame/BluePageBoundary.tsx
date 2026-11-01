import { Component, type ReactNode } from 'react'
import { EhrButton } from '@hid/ui/ehr'
import { focusLost } from '../../pageFocus'

interface BluePageBoundaryProps {
  readonly children: ReactNode
  /** "Use the classic EHR", as the account menu offers it. */
  readonly onClassic?: () => void
  /** What Reload does: the page's own reload, unless a test says otherwise. */
  readonly reload?: () => void
}

/**
 * What a blue page that fails to render leaves, inside the frame: the sidebar, the top bar and the account menu stay,
 * so staff can go elsewhere or back to the classic EHR. It says what today's app says when a page fails
 * (AppErrorBoundary) and, like it, shows nothing of the failure, whose message may hold anything the page held. The
 * frame gives it the page's address as its key, so going to another page tries again.
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
        <p className="hid-ehr-blue-flush">This page could not be shown. Reload it to try again, or go back to Home.</p>
        <div className="hid-ehr-actions">
          <EhrButton onClick={() => { if (this.props.reload) this.props.reload(); else window.location.reload() }}>Reload</EhrButton>
          <EhrButton variant="secondary" onClick={() => { window.location.assign('/provider') }}>Go to Home</EhrButton>
        </div>
      </div>
    )
  }
}
