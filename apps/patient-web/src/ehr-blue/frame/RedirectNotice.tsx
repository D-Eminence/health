import { useLocation, useNavigate } from 'react-router-dom'

/** What Home says after the frame sends someone there from a page their role may not open (the design's words). */
export const DENIED_NOTICE = 'Your current permissions no longer allow that page. Choose an authorized workflow.'

/**
 * The note the frame leaves with a redirect (the history entry's state, never storage), above the page it lands on,
 * until it is dismissed or the person moves on.
 */
export function RedirectNotice() {
  const location = useLocation()
  const navigate = useNavigate()
  const notice = (location.state as { notice?: unknown } | null)?.notice
  if (typeof notice !== 'string') return null
  return <div className="hid-ehr-blue-notice" role="status">
    <p>{notice}</p>
    <button type="button" aria-label="Dismiss notice"
      onClick={() => navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null })}>
      ×
    </button>
  </div>
}
