import { Link } from 'react-router-dom'
import { Card, EmptyState } from '@hid/ui'
import { useStaff } from '../App'
import { CapturePage } from './CapturePage'
import { attentionText, CAPTURE, ONLINE_ONLY, pendingCountText } from './copy'
import { offlineRuntime, useOffline, useOfflineActive, useOfflineSummary } from './runtime'

/** The Overview's offline card: what waits to be sent, and Migrate capture. Nothing unless offline is in use. */
export function OfflineOverviewCard({ canCapture }: { canCapture: boolean }) {
  const runtime = offlineRuntime()
  const active = useOfflineActive(runtime)
  const summary = useOfflineSummary(runtime)
  if (!active || !summary) return null
  return <Card className="staff-card"><h2>On this device</h2>
    <p>{pendingCountText(summary.pending)}</p>
    {summary.attention > 0 && <p>{attentionText(summary.attention)}</p>}
    {canCapture && <Link to="/provider/capture" className="staff-text-link">{CAPTURE.title} →</Link>}
  </Card>
}

/** Says, instead of failing, that a page needs a connection; offline in use only. */
export function OnlineOnlyNotice() {
  const runtime = offlineRuntime()
  const active = useOfflineActive(runtime)
  const offline = useOffline(runtime)
  if (!active || !offline) return null
  return <p className="staff-notice" role="status">{ONLINE_ONLY}</p>
}

/** On Migrate and OCR pages: the way to capture documents while offline is in use. */
export function CaptureLink({ permissions }: { permissions: readonly string[] }) {
  const active = useOfflineActive(offlineRuntime())
  if (!active || !permissions.includes('ehr.document.write')) return null
  return <p><Link to="/provider/capture" className="staff-text-link">{CAPTURE.title} →</Link></p>
}

/** The capture page's route: open while offline is in use at this facility, for a role that may add documents. */
export function CaptureRoute() {
  const { state } = useStaff()
  const runtime = offlineRuntime()
  const active = useOfflineActive(runtime)
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  if (!runtime || !active || !facility) return <EmptyState titleAs="h1" title="Page not found" description="This provider page is unavailable." />
  if (!facility.permissions.includes('ehr.document.write')) return <EmptyState titleAs="h1" title={CAPTURE.title} description="Your role at this facility cannot add documents." />
  return <CapturePage runtime={runtime} facilityId={facility.id} />
}
