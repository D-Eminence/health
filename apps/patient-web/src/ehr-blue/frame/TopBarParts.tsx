import { normalizeHealthIdInput } from '@hid/contracts'
import { Bell, ChevronRight, IdCard, RotateCcw, Search, ShieldAlert } from 'lucide-react'
import { isValidElement, useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { EhrButton, EhrDrawer, EhrIcon, EhrPopover, EhrSampleBanner } from '@hid/ui/ehr'
import { Drawer } from '../../kasuwa/interactive'
import { LoadingRows } from '../../kasuwa/parts'
import { Alert, Button, Card, EmptyState, Field, IconChip, Input, ListRow } from '../../kasuwa/ui'
import { isDemoFacility } from '../blueFacilities'
import { healthIdProblem } from '../clinical/consent/access'
import { useStaff } from '../../staff/App'
import { roleLabels } from '../../staff/staffAccess'
import { usesNovuBackend } from '../../backendContract'
import { useAccessRequests, useReloadAccessRequests } from './attention'
import { sampleModule, sampleRecords } from './sample/store'
import { useBluePages, useSampleHref } from './pageContext'
import { SampleWorkspace } from './sample/SampleWorkspace'
import { basePath, pageHrefOf } from './pageHref'
import type { EhrBluePage } from './types'

/**
 * The top bar's controls (design: screens/panels). Search finds a patient by Health ID, or goes to a page; the bell says
 * what waits; the demo chip says what is live; the account menu signs out and switches facility, with today's session
 * logic.
 */

/**
 * Whether typed text is a Health ID, to offer "Find patient" first. A page name can also normalise to a complete Health
 * ID ("pharmacy" is HID-PHARMACY), so it counts only when typed with its HID prefix or with a digit in it.
 */
export function typedHealthId(query: string): string | null {
  const trimmed = query.trim()
  if (!trimmed) return null
  const normalized = normalizeHealthIdInput(trimmed)
  if (healthIdProblem(normalized) !== null) return null
  return /^hid/i.test(trimmed) || /\d/.test(trimmed) ? normalized : null
}

export function WorkspaceSearch({ pages }: { readonly pages: readonly EhrBluePage[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const { lock } = useStaff()
  // Ctrl+K or Command+K opens it from anywhere in the workspace, but not over the session check (the lock screen).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (lock !== null) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lock])
  const words = query.trim().toLowerCase()
  const found = pages.filter(page => !words || page.label.toLowerCase().includes(words) || page.group.toLowerCase().includes(words))
  // Find a patient only where the person may open it.
  const canFind = pages.some(page => basePath(page.path) === 'patients')
  const hid = canFind ? typedHealthId(query) : null
  const close = () => { setOpen(false); setQuery('') }
  const go = (to: string, state?: unknown) => { close(); navigate(to, state === undefined ? undefined : { state }) }
  // Enter takes the first offer: the patient when the text is a Health ID, otherwise the first page.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (hid) go('/provider/patients', { hid })
    else if (found[0]) go(pageHrefOf(found[0]))
  }
  const followLink = (to: string, state?: unknown) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    go(to, state)
  }
  const row = 'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink no-underline hover:bg-subtle focus-visible:bg-subtle'
  return <>
    <EhrButton variant="secondary" icon={<EhrIcon name="search" />} aria-keyshortcuts="Control+K Meta+K" onClick={() => setOpen(true)}>
      <span className="hid-ehr-blue-label">Search</span><kbd className="hid-ehr-blue-kbd" aria-hidden="true">Ctrl K</kbd>
    </EhrButton>
    <Drawer open={open} title="Search" onClose={close}>
      <form role="search" className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Health ID or page" htmlFor="ehr-search-query" className="[&>label]:sr-only">
          <Input id="ehr-search-query" data-autofocus type="search" icon={Search} autoComplete="off" spellCheck={false} placeholder="Health ID or page"
            value={query} onChange={event => setQuery(event.target.value)} />
        </Field>
        {hid ? <section aria-labelledby="ehr-search-patient" className="flex flex-col gap-1">
          <h3 id="ehr-search-patient" className="m-0 px-3 text-[12px] font-semibold tracking-[.06em] text-ink-3 uppercase">Patient</h3>
          <a className={row} href="/provider/patients" onClick={followLink('/provider/patients', { hid })}>
            <IdCard className="size-[18px] shrink-0 text-brand-ink" aria-hidden />
            <span className="min-w-0 flex-1">Find patient <span className="font-medium tracking-[.04em]">{hid}</span></span>
            <ChevronRight className="size-4 text-ink-3" aria-hidden />
          </a>
        </section> : null}
        <section aria-labelledby="ehr-search-pages" className="flex flex-col gap-1">
          <h3 id="ehr-search-pages" className="m-0 px-3 text-[12px] font-semibold tracking-[.06em] text-ink-3 uppercase">Go to page</h3>
          {found.length > 0 ? <nav aria-label="Pages">
            {found.map(page => <a key={page.path} className={row} href={pageHrefOf(page)} onClick={followLink(pageHrefOf(page))}>
              <span className="min-w-0 flex-1">{page.label}<span className="block text-[12px] text-ink-3">{page.group || 'Home'}{page.status === 'sample' ? ' · sample' : ''}</span></span>
            </a>)}
          </nav> : <p className="m-0 px-3 text-[13px] text-ink-3">No page matches. Try another word.</p>}
        </section>
      </form>
    </Drawer>
  </>
}

export function NotificationsButton() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { state } = useStaff()
  const read = useAccessRequests()
  const reload = useReloadAccessRequests()
  // Sample activity links only into a sample this session may open: a workspace closed to the role would send them
  // Home, and a live page at the module's address would not find a sample record.
  const hrefOf = useSampleHref()
  // The frame's sample records are found only by the frame's own sample page: a clinical or department sample at the
  // same address keeps records of its own, so its row opens that workspace's list instead.
  const pages = useBluePages()
  const ownsRecords = (href: string, moduleId: string) => pages.some(page => pageHrefOf(page) === href
    && isValidElement<{ moduleId?: string }>(page.element) && page.element.type === SampleWorkspace
    && page.element.props.moduleId === moduleId)
  const activity = SAMPLE_ACTIVITY.flatMap(moduleId => {
    const module = sampleModule(moduleId)
    const record = sampleRecords(moduleId)[0]
    const href = hrefOf(moduleId)
    return module && record && href !== null ? [{ moduleId, module, href: ownsRecords(href, moduleId) ? `${href}/${record.id}` : null, list: href }] : []
  })
  const pending = read.state === 'ready' ? read.pending : 0
  // Recent activity is sample data: shown only at a demo facility.
  const demo = isDemoFacility(state.status === 'ready' ? state.session.actor.facility?.id : null)
  return <>
    <EhrButton variant="secondary" icon={<EhrIcon name="bell" />} onClick={() => { setOpen(true); reload() }}
      aria-label={pending > 0 ? `Notifications, ${pending} waiting` : 'Notifications'}>
      <span className="hid-ehr-blue-label">Notifications</span>{pending > 0 ? <span className="hid-ehr-blue-count" aria-hidden="true">{pending}</span> : null}
    </EhrButton>
    <Drawer open={open} title="Notifications" onClose={() => setOpen(false)}>
      <div className="flex flex-col gap-5">
        {read.state === 'none' ? <EmptyState compact icon={Bell} title="Nothing waiting" description="Access requests show here for roles that answer them." />
          : read.state === 'loading' ? <LoadingRows rows={1} label="Loading access requests" />
            : read.state === 'failed' ? <Alert intent="error" title="Couldn’t load access requests"
              action={<Button size="sm" icon={RotateCcw} onClick={reload}>Try again</Button>}>{read.message}</Alert>
              : read.pending === 0 ? <EmptyState compact icon={Bell} title="Nothing waiting" description="New access requests show here." />
                : <Card><ListRow onClick={() => { setOpen(false); navigate('/provider/requests') }}
                  leading={<IconChip size="sm" icon={ShieldAlert} tone="warn" />} title={`${read.pending} access request${read.pending === 1 ? '' : 's'} waiting`}
                  subtitle="Review them" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></Card>}
        {/* No sample workspace open to this role: no Recent activity at all, rather than an empty list. */}
        {demo && activity.length > 0 ? <section aria-labelledby="ehr-notifications-recent" className="flex flex-col gap-2">
          <h3 id="ehr-notifications-recent" className="m-0 text-[12px] font-semibold tracking-[.06em] text-ink-3 uppercase">Recent activity · sample</h3>
          <Card><ul className="m-0 list-none divide-y divide-line p-0">
            {/* A row opens the record where the frame's own sample page keeps it, else that workspace's list. */}
            {activity.map(({ moduleId, module, href, list }) => <li key={moduleId}><ListRow title={`${module.title} record created`}
              trailing={<Button size="sm" iconRight={ChevronRight} aria-label={href ? `Open ${module.title} record` : `Open ${module.title}`}
                onClick={() => { setOpen(false); navigate(href ?? list) }}>{href ? 'Open record' : 'Open list'}</Button>} /></li>)}
          </ul></Card>
        </section> : null}
      </div>
    </Drawer>
  </>
}

/** The workspaces the design's notification list draws from (screens/panels/notifications-drawer.png). */
const SAMPLE_ACTIVITY = ['appointments', 'quality', 'nursing', 'icu', 'referrals'] as const

export function DemoChip({ facility }: { readonly facility: string }) {
  const navigate = useNavigate()
  return (
    <EhrPopover trigger="Demo" label="About this demo" triggerClassName="hid-ehr-blue-chip">
      {close => <>
        <p><strong>{facility} is a Health ID demo facility.</strong></p>
        <p className="hid-ehr-blue-muted">Live pages use Health ID. Pages marked as samples are not connected yet: their data is fictional and is gone when you reload.</p>
        <EhrButton variant="secondary" size="sm" onClick={() => { close(false); navigate('/provider/whats-left') }}>See what’s left</EhrButton>
      </>}
    </EhrPopover>
  )
}

function initials(name: string): string {
  const letters = name.split(/\s+/).filter(Boolean).map(word => word[0]!.toUpperCase())
  return (letters.length > 1 ? letters[0]! + letters.at(-1)! : letters[0] ?? 'H').slice(0, 2)
}

/**
 * The account menu, as the design draws it (screens/panels/account-menu.png). The frame's own account controls are the
 * sidebar person's menu (Sign out, facility switch).
 */
export function AccountMenu({ onSample }: {
  readonly onSample?: (panel: 'profile' | 'preferences' | 'help') => void
}) {
  const { state, signOut } = useStaff()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  if (state.status !== 'ready') return null
  const { actor } = state.session
  const name = actor.displayName ?? actor.email ?? 'Staff member'
  const facility = actor.facility
  const roles = facility ? (usesNovuBackend() ? roleLabels(facility.roles) : facility.roles.join(', ')) || 'Staff' : 'Staff'

  async function leave() {
    if (signingOut) return
    setError('')
    setSigningOut(true)
    try { await signOut() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign-out could not be completed.') }
    finally { setSigningOut(false) }
  }

  return <>
    <EhrPopover trigger={<span className="hid-ehr-blue-avatar" aria-hidden="true">{initials(name)}<span className="hid-ehr-blue-presence" /></span>} triggerLabel="Account menu" label="Account">
      {close => (
        <div className="hid-ehr-blue-menu">
          <p className="hid-ehr-blue-menu-name">{name}</p>
          <p className="hid-ehr-blue-muted">{roles}</p>
          {onSample ? <>
            <EhrButton variant="secondary" onClick={() => { close(false); onSample('profile') }}>My profile</EhrButton>
            <EhrButton variant="secondary" className="hid-ehr-blue-menu-status" onClick={() => { close(false); onSample('profile') }}>
              Status: Online
            </EhrButton>
            <EhrButton variant="secondary" onClick={() => { close(false); onSample('preferences') }}>Preferences</EhrButton>
            <EhrButton variant="secondary" onClick={() => { close(false); onSample('help') }}>Help</EhrButton>
          </> : null}
          {actor.facilities.length > 1 ? (
            <EhrButton variant="secondary" onClick={() => { close(false); navigate('/provider/institutions') }}>Switch facility</EhrButton>
          ) : null}
          <EhrButton variant="secondary" busy={signingOut} onClick={leave}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </EhrButton>
        </div>
      )}
    </EhrPopover>
    {error ? <p role="alert" className="hid-ehr-error hid-ehr-blue-topbar-error">{error}</p> : null}
  </>
}

/** The sample panels the account menu opens (screens/admin/profile.png and the design's preferences and help). */
export function AccountSamplePanel({ panel, onClose }: { readonly panel: 'profile' | 'preferences' | 'help' | null; readonly onClose: () => void }) {
  const { state } = useStaff()
  const actor = state.status === 'ready' ? state.session.actor : null
  const title = panel === 'profile' ? 'My profile' : panel === 'preferences' ? 'Preferences' : 'Help'
  return (
    <EhrDrawer open={panel !== null} title={title} onClose={onClose}>
      <EhrSampleBanner />
      {panel === 'profile' ? <dl className="hid-ehr-blue-facts">
        <div className="hid-ehr-blue-fact"><dt>Name</dt><dd>{actor?.displayName ?? 'Not recorded'}</dd></div>
        <div className="hid-ehr-blue-fact"><dt>Status</dt><dd>Online (sample)</dd></div>
        <div className="hid-ehr-blue-fact"><dt>Photo</dt><dd>Not added (sample)</dd></div>
      </dl> : panel === 'preferences' ? <p>Sound, notification and display preferences arrive with the presence service.</p>
        : <p>Use Search (Ctrl+K or Command+K) to find a patient by Health ID or go to a page. For access or account help, ask your facility administrator.</p>}
    </EhrDrawer>
  )
}
