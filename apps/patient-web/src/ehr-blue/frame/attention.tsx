import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { staffApi, type AccessRequest } from '../../staff/api'
import { accessRequestsError } from '../../staff/routes/AccessRequests'

/**
 * The facility's access requests, shared by the bell and Home. The frame reads them once when it opens for a facility
 * (and again on a facility switch), so the bell counts them on landing as today's Overview did on opening
 * (staff/routes/Dashboard.tsx:251-257), even on a product site where Home is not the first page. After that they are
 * read when asked: each time Home opens and each time the Notifications drawer opens. Nothing polls. A facility
 * without identity.consent.write reads nothing.
 */
export type AccessRequestsRead =
  | { readonly state: 'none' }
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'ready'; readonly requests: readonly AccessRequest[]; readonly pending: number }

interface Attention {
  readonly read: AccessRequestsRead
  /** Reads the requests again, now. */
  readonly reload: () => void
}

const AttentionContext = createContext<Attention>({ read: { state: 'none' }, reload: () => {} })

export function AttentionProvider({ facilityId, permissions, children }: {
  readonly facilityId: string | undefined; readonly permissions: readonly string[]; readonly children: ReactNode
}) {
  const allowed = permissions.includes('identity.consent.write')
  const [read, setRead] = useState<AccessRequestsRead>({ state: 'none' })
  // How many reads were asked for, and for which facility.
  const [asked, setAsked] = useState<{ readonly facilityId: string | undefined; readonly count: number }>({ facilityId: undefined, count: 0 })
  // The facility whose opening read is still on its way: Home or the drawer asking meanwhile shares it (each read is
  // audited), rather than read the same list twice on landing.
  const landing = useRef<string | undefined>(undefined)
  const reload = useCallback(() => {
    if (facilityId && landing.current === facilityId) return
    setAsked(current => ({ facilityId, count: current.count + 1 }))
  }, [facilityId])
  // The opening read, once per facility. Home asking in the same render (its effect runs first) folds into this one,
  // as both updates land in the same render.
  useEffect(() => {
    if (!facilityId || !allowed) return
    landing.current = facilityId
    setAsked(current => ({ facilityId, count: current.count + 1 }))
  }, [facilityId, allowed])
  useEffect(() => {
    if (!facilityId || !allowed || asked.facilityId !== facilityId || asked.count === 0) {
      setRead({ state: 'none' })
      return
    }
    let active = true
    setRead({ state: 'loading' })
    void staffApi.listAccessRequests(facilityId).then(
      requests => {
        if (landing.current === facilityId) landing.current = undefined
        if (!active) return
        const list = Array.isArray(requests) ? requests : []
        setRead({ state: 'ready', requests: list, pending: list.filter(request => request.status === 'pending').length })
      },
      caught => {
        if (landing.current === facilityId) landing.current = undefined
        if (active) setRead({ state: 'failed', message: accessRequestsError(caught) })
      })
    return () => { active = false }
  }, [facilityId, allowed, asked])
  const value = useMemo(() => ({ read, reload }), [read, reload])
  return <AttentionContext.Provider value={value}>{children}</AttentionContext.Provider>
}

export function useAccessRequests(): AccessRequestsRead {
  return useContext(AttentionContext).read
}

/**
 * Asks for the access requests to be read now (Home on opening, the bell's drawer on opening), or shares the frame's
 * opening read while it is on its way.
 */
export function useReloadAccessRequests(): () => void {
  return useContext(AttentionContext).reload
}
