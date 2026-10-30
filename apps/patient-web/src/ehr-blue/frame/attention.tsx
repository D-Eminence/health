import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { staffApi, type AccessRequest } from '../../staff/api'
import { accessRequestsError } from '../../staff/routes/AccessRequests'

/**
 * The facility's access requests, read once when the frame opens at a facility that may answer them
 * (identity.consent.write), as today's Overview reads them, and shared by the bell and Home. A facility without the
 * permission reads nothing.
 */
export type AccessRequestsRead =
  | { readonly state: 'none' }
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'ready'; readonly requests: readonly AccessRequest[]; readonly pending: number }

const AttentionContext = createContext<AccessRequestsRead>({ state: 'none' })

export function AttentionProvider({ facilityId, permissions, children }: {
  readonly facilityId: string | undefined; readonly permissions: readonly string[]; readonly children: ReactNode
}) {
  const allowed = permissions.includes('identity.consent.write')
  const [read, setRead] = useState<AccessRequestsRead>({ state: 'none' })
  useEffect(() => {
    if (!facilityId || !allowed) {
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
  }, [facilityId, allowed])
  return <AttentionContext.Provider value={read}>{children}</AttentionContext.Provider>
}

export function useAccessRequests(): AccessRequestsRead {
  return useContext(AttentionContext)
}
