import { X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button } from '../../kasuwa/ui'

/**
 * The note a redirect leaves (the frame's own redirects, and any page that sends someone on with `frameNotice`). A page
 * this session's role may not open no longer sends anyone Home with a general note: it refuses in its place, in its own
 * words (BlueFrame.tsx Refused; parity report 3.3-50).
 *
 * The note the frame leaves with a redirect (the history entry's state, never storage), above the page it lands on,
 * until it is dismissed or the person moves on. It has a key of its own, frameNotice: a page's own `notice` (Patients'
 * "closed", a sent access request's line) is that page's to show, not the frame's.
 */
export function RedirectNotice() {
  const location = useLocation()
  const navigate = useNavigate()
  const notice = (location.state as { frameNotice?: unknown } | null)?.frameNotice
  if (typeof notice !== 'string') return null
  return <Alert intent="info" className="hid-ehr-blue-redirect-notice"
    action={<Button variant="ghost" size="sm" icon={X} aria-label="Dismiss notice"
      onClick={() => navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null })} />}>
    {notice}
  </Alert>
}
