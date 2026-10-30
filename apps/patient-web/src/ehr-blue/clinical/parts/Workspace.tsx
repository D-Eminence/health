import '@hid/ui/ehr.css'
import '../clinical.css'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useStaff } from '../../../staff/App'
import { SampleBanner } from './SampleBanner'

/**
 * Where the blue EHR is mounted. The frame mounts each page at `${base}/${path}/*`; the page works out `base` from
 * the URL, so links between workspaces (`href('appointments')`) need no knowledge of the frame's own route.
 */
interface WorkspaceValue {
  readonly base: string
  readonly path: string
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

/** The root of one clinical workspace page: `.hid-ehr-clinical-page`, with the sample notice when `sample`. */
export function Workspace({ path, sample = false, children }: { path: string; sample?: boolean; children: ReactNode }) {
  const { pathname } = useLocation()
  const rest = useParams()['*'] ?? ''
  const base = useMemo(() => {
    let mount = rest && pathname.endsWith(rest) ? pathname.slice(0, pathname.length - rest.length) : pathname
    mount = mount.replace(/\/+$/, '')
    return mount.endsWith(`/${path}`) ? mount.slice(0, mount.length - path.length - 1) : mount
  }, [pathname, path, rest])
  const value = useMemo(() => ({ base, path }), [base, path])

  return (
    <WorkspaceContext.Provider value={value}>
      <div className="hid-ehr-clinical-page" data-workspace={path}>
        {sample ? <SampleBanner /> : null}
        {children}
      </div>
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
    const href = (...parts: string[]) => join(value.path, ...parts)
    href.to = (workspace: string, ...parts: string[]) => join(workspace, ...parts)
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
  const permissions = useMemo(() => facility?.permissions ?? [], [facility])
  const can = useMemo(() => {
    const held = new Set(permissions)
    return (...needed: string[]) => needed.every(permission => held.has(permission))
  }, [permissions])
  return { ...staff, facility, permissions, can }
}
