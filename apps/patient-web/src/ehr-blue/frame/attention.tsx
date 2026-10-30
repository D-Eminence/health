import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { staffApi, type AccessRequest } from '../../staff/api'
import { accessRequestsError } from '../../staff/routes/AccessRequests'

/**
 * The facility's access requests, shared by the bell and Home. They are read when asked, as today's portal reads them
 * where it shows them: each time Home opens (as today's Overview does) and each time the Notifications drawer opens,
 * never by the frame on another page. A facility without identity.consent.write reads nothing; a facility switch
 * forgets what was read until it is asked again.
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
  const reload = useCallback(() => setAsked(current => ({ facilityId, count: current.count + 1 })), [facilityId])
  useEffect(() => {
    if (!facilityId || !allowed || asked.facilityId !== facilityId || asked.count === 0) {
      setRead({ state: 'none' })
      return
    }
    let active = true
    setRead({ state: 'loading' })
    void staffApi.listAccessRequests(facilityId).then(
      requests => {
        if (!active) return
        const list = Array.isArray(requests) ? requests : []
        setRead({ state: 'ready', requests: list, pending: list.filter(request => request.status === 'pending').length })
      },
      caught => { if (active) setRead({ state: 'failed', message: accessRequestsError(caught) }) })
    return () => { active = false }
  }, [facilityId, allowed, asked])
  const value = useMemo(() => ({ read, reload }), [read, reload])
  return <AttentionContext.Provider value={value}>{children}</AttentionContext.Provider>
}

export function useAccessRequests(): AccessRequestsRead {
  return useContext(AttentionContext).read
}

/** Asks for the access requests to be read now (Home on opening, the bell's drawer on opening). */
export function useReloadAccessRequests(): () => void {
  return useContext(AttentionContext).reload
}
