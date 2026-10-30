import '@hid/ui/ehr.css'
import '../clinical.css'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { useStaff } from '../../../staff/App'
import { SampleBanner } from './SampleBanner'
import { segmentOf } from './segments'

/**
 * Where the blue EHR is mounted. The frame shows each page at `${base}/${segment}` and every address below it; the
 * page works out `base` from the address, so links between workspaces (`href.to('appointments')`) need no knowledge of
 * the frame's own route.
 */
interface WorkspaceValue {
  readonly base: string
  readonly path: string
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

/**
 * The root of one clinical workspace page: `.hid-ehr-clinical-page`, with the sample notice when `sample`. Its relative
 * routes (index, `new`, `:recordId`) match the address below the workspace's segment, both where the frame renders the
 * page under today's provider routes (the address left is `clinical/…`) and where a route `${segment}/*` mounts it
 * (the address left is `…`).
 */
export function Workspace({ path, title, sample = false, children }: { path: string; title?: string; sample?: boolean; children: ReactNode }) {
  const segment = segmentOf(path)
  const { pathname } = useLocation()
  const { lock } = useStaff()
  // Inside the frame, today's ProviderTitle (staff/App.tsx) renames the tab on a move below a page today's portal serves
  // (clinical/new reads "Page not found · Health ID Provider"), and the frame names it only when its page changes. Named
  // again, after the frame's label, on every move inside this workspace: a label only, never a patient.
  useEffect(() => {
    if (title && lock === null) document.title = `${title} · Health ID EHR`
  }, [title, pathname, lock])
  const base = useMemo(() => {
    const parts = pathname.split('/')
    const at = parts.indexOf(segment, 1)
    return at > 0 ? parts.slice(0, at).join('/') : pathname.replace(/\/+$/, '')
  }, [pathname, segment])
  const value = useMemo(() => ({ base, path }), [base, path])
  const page = (
    <div className="hid-ehr-clinical-page" data-workspace={path}>
      {sample ? <SampleBanner /> : null}
      {children}
    </div>
  )

  return (
    <WorkspaceContext.Provider value={value}>
      <Routes>
        <Route path={`${segment}/*`} element={page} />
        <Route path="*" element={page} />
      </Routes>
    </WorkspaceContext.Provider>
  )
}

/**
 * Links inside the blue EHR. `href()` is this workspace's list; `href('new')` and `href(recordId)` its pages;
 * `href.to('appointments')` or `href.to('consult', 'new')` another workspace.
 */
export function useWorkspaceHref() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('Clinical pages render inside <Workspace>')
  return useMemo(() => {
    const join = (...parts: string[]) => [value.base, ...parts.filter(Boolean).map(encodeSegment)].join('/') || '/'
    const href = (...parts: string[]) => join(segmentOf(value.path), ...parts)
    href.to = (workspace: string, ...parts: string[]) => join(segmentOf(workspace), ...parts)
    return href
  }, [value])
}

function encodeSegment(part: string) {
  return part.split('/').map(encodeURIComponent).join('/')
}

/**
 * The working facility, its permissions and the open patient, from today's staff session (`useStaff()`).
 * Permissions are the working facility's, never the actor's across facilities.
 */
export function useClinical() {
  const staff = useStaff()
  const facility = staff.state.status === 'ready' ? staff.state.session.actor.facility : undefined
  const held = facility?.permissions
  const permissions = useMemo(() => held ?? [], [held])
  const can = useMemo(() => {
    const granted = new Set(permissions)
    return (...needed: string[]) => needed.every(permission => granted.has(permission))
  }, [permissions])
  return { ...staff, facility, permissions, can }
}
