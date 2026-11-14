import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Where an address with more after the page's own base goes: back to the base. The frame's links to a sample record
 * (Home's dashboards, the Notifications drawer: /provider/insurance/<id>) carry ids from the frame's own sample store,
 * which these pages do not hold, so the page shows its list and the address loses the rest. The id is never looked up.
 *
 * `base` is the page's own path without '/*' ('insurance'). Returns whether the address is being replaced.
 */
export function useListAtBase(base: string): boolean {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // The router matches an address in any case ('/provider/Insurance/…'), so this does too.
  const marker = `/${base}/`.toLowerCase()
  const at = pathname.toLowerCase().indexOf(marker)
  const target = at >= 0 && pathname.length > at + marker.length ? pathname.slice(0, at + marker.length - 1) : null
  useEffect(() => { if (target) navigate(target, { replace: true }) }, [target, navigate])
  return target !== null
}
