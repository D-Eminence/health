import { isValidElement, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { EhrAppShell, EhrModuleTabs, type EhrNavGroup, type EhrNavItem } from '@hid/ui/ehr'
import { Activity, Check, Hospital, House, Search, ShieldCheck, UserPlus, UserRound } from 'lucide-react'
import { AppShell, type NavGroup, type NavItem } from '../../kasuwa/AppShell'
import { Badge, cx, type Icon } from '../../kasuwa/ui'
import { useStaff } from '../../staff/App'
import { ReviewBanner } from '../../staff/routes/ReviewBanner'
import { BillingBanner } from '../../staff/routes/Billing'
import { BrandLogo } from '../../BrandLogo'
import { useFocusOnPageChange } from '../../pageFocus'
import { isDemoFacility } from '../blueFacilities'
import { PRODUCTS, inProduct, productOf } from './product'
import { BLUE_PAGES, isLiveOnlyPath, liveOnlyTitle, matchBluePage, movedAddress, pageAllowed, pageTabs } from '../routes'
import { AttentionProvider } from './attention'
import { BluePageBoundary } from './BluePageBoundary'
import { ConnectionStatus } from './ConnectionStatus'
import { DeniedPage, LivePage, UnknownPage } from './LivePages'
import { BluePageProvider, BluePagesProvider, OpenPagesProvider } from './pageContext'
import { basePath, pageHrefOf } from './pageHref'
import { AccountSamplePanel, DemoChip, NotificationsButton, WorkspaceSearch } from './TopBarParts'
import type { EhrBluePage } from './types'

/**
 * The design's Clinical group holds 17 pages: too many to scan (Hick's Law, Miller's 7 ± 2). The sidebar splits it
 * by where the work happens, in the order a patient meets it; the pages and their permissions are unchanged.
 */
const CLINICAL_SIDEBAR: Readonly<Record<string, string>> = {
  patients: 'Front desk', registration: 'Front desk', 'in-person-check': 'Front desk', appointments: 'Front desk', journey: 'Front desk',
  triage: 'Care', clinical: 'Care', nursing: 'Care', 'nursing-tasks': 'Care', requests: 'Care',
  inpatient: 'Wards & units', wards: 'Wards & units', emergency: 'Wards & units', maternity: 'Wards & units',
  surgery: 'Wards & units', icu: 'Wards & units', dental: 'Wards & units',
}

/** A page's EHR icon (an element) as the shell's icon component: it takes the shell's size and colour. */
const iconCache = new WeakMap<object, Icon>()
function iconOf(element: ReactNode): Icon {
  if (element && typeof element === 'object' && iconCache.has(element)) return iconCache.get(element)!
  const Wrapped: Icon = ({ className }) => <span className={cx('inline-flex items-center justify-center [&_svg]:size-full', className)}>{element}</span>
  if (element && typeof element === 'object') iconCache.set(element, Wrapped)
  return Wrapped
}

/** Design tools for the team, not places staff work: reachable by address, never listed. */
const INTERNAL_GROUPS: ReadonlySet<string> = new Set(['Design review', 'Design tour'])

/** The heading a page is listed under in the sidebar. */
export function sidebarGroupOf(page: Pick<EhrBluePage, 'path' | 'group'>): string {
  return page.group === 'Clinical' ? CLINICAL_SIDEBAR[basePath(page.path)] ?? page.group : page.group
}

/** The sidebar: the pages the facility may open, by group, in order; a lone page named as its group gets no heading. */
export function navigationGroups(pages: readonly EhrBluePage[]): EhrNavGroup[] {
  const groups: { id: string; label: string; items: EhrNavItem[] }[] = []
  for (const page of pages) {
    const label = sidebarGroupOf(page)
    let group = groups.find(candidate => candidate.label === label)
    if (!group) {
      group = { id: label || 'home', label, items: [] }
      groups.push(group)
    }
    group.items.push({ id: page.path, label: page.label, href: pageHrefOf(page), icon: page.icon })
  }
  return groups.map(group => ({
    id: group.id,
    items: group.items,
    ...(group.label && !(group.items.length === 1 && group.items[0]!.label === group.label) ? { label: group.label } : {}),
  }))
}

/**
 * The blue Hospital EHR's frame: EhrAppShell with the design's sidebar and top bar, and the page
 * the address opens. Session, sign-out and facility switch are today's (useStaff). A page another folder exports
 * replaces the frame's stand-in for its path; an address no page takes says so.
 */
export function BlueFrame() {
  const { state, lock, signOut } = useStaff()
  const location = useLocation()
  const navigate = useNavigate()
  const pageRef = useRef<HTMLDivElement>(null)
  const [samplePanel, setSamplePanel] = useState<'profile' | 'preferences' | 'help' | null>(null)
  useFocusOnPageChange(pageRef, lock !== null)
  const session = state.status === 'ready' ? state.session : null
  const facility = session?.actor.facility
  const permissions = useMemo(() => facility?.permissions ?? [], [facility])
  const allowed = useMemo(() => BLUE_PAGES.filter(page => pageAllowed(page, session)), [session])
  // What the sidebar and search offer: the allowed pages this session lists.
  // Only working screens are offered (the owner's decision of 2026-10-31): sample modules with fictional figures stay in
  // the code for demos but are not listed in the sidebar or search. Home is always listed.
  // A lab, pharmacy or outreach on its own sees only its product (product.ts); a hospital's EHR has them all.
  const product = productOf(window.location.hostname, permissions)
  const info = PRODUCTS[product]
  const listed = useMemo(() => allowed.filter(page => (page.status !== 'sample' || page.path === '') && !INTERNAL_GROUPS.has(page.group)
    && inProduct(product, page.path) && (product === 'ehr' || page.path !== '')
    && (!session || (page.listed?.(session) ?? true))), [allowed, session, product])
  const match = matchBluePage(BLUE_PAGES, location.pathname)
  // A pharmacy or lab on its own lists a product's pages in the sidebar, so it draws no tabs above them as well.
  const tabs = match && product === 'ehr' ? pageTabs(allowed, match.page) : []
  const shownTitle = match ? match.page.label : liveOnlyTitle(location.pathname) ?? 'Page not found'
  // Today's tab title names today's pages only: the blue page names itself once the workspace is open.
  useEffect(() => {
    if (lock === null && session) document.title = `${shownTitle} · Health ID ${info.name}`
  }, [shownTitle, lock, session, info.name])
  if (!session) return null
  const moved = movedAddress(location.pathname)
  if (moved) return <Navigate replace to={{ pathname: moved, search: location.search, hash: location.hash }} />
  // A single product's home is its own queue.
  if (product !== 'ehr' && /^\/provider\/?$/.test(location.pathname)) return <Navigate replace to={{ pathname: `/provider/${info.home}`, search: location.search }} />

  const follow = (item: { href: string }, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    navigate(item.href)
  }


  // Today's page refuses in its own words ("Laboratory unavailable"), and reads nothing without the permission.
  const todayRefuses = match !== null && match.page.status === 'live' && isValidElement(match.page.element)
    && match.page.element.type === LivePage && (match.page.visible?.(session) ?? true)
  const content = match
    ? pageAllowed(match.page, session) || todayRefuses
      ? <BluePageProvider value={match}>{match.page.element}</BluePageProvider>
      : match.page.refusal ?? <DeniedPage label={match.page.label} facility={facility?.name ?? 'this facility'} />
    : isLiveOnlyPath(location.pathname) ? <LivePage /> : <UnknownPage />

  const name = session.actor.displayName ?? session.actor.email ?? 'Staff member'
  const roles = facility ? facility.roles.join(', ') || 'Staff' : 'Staff'
  // In the EHR a page that joins another's tabs has no sidebar entry; in a single product (a pharmacy or lab on its own)
  // each is listed by its tab name ("To dispense", "New sale", "Stock").
  // A single product's own pages come first (its menu), then anything else it holds (settings, insight).
  const own = (page: EhrBluePage) => basePath(page.path) === info.home || basePath(page.path).startsWith(`${info.home}/`)
  const ordered = product === 'ehr' ? listed : [...listed.filter(own), ...listed.filter(page => !own(page))]
  const groups = navigationGroups(product === 'ehr' ? ordered.filter(page => !page.tabOf)
    : ordered.map(page => page.tabLabel ? { ...page, label: page.tabLabel } : page))
  // The groups a clinician opens all day stay open; the rest fold (Hick's Law), each opening while it holds the page.
  // A single product's own group is its whole job, so it stays open too.
  // (A pharmacy's home is a menu of pages below it, pharmacy/sell first: its group is theirs.)
  const OPEN = new Set(['Front desk', 'Care', ...(product === 'ehr' ? [] : [listed.find(page => basePath(page.path) === info.home
    || basePath(page.path).startsWith(`${info.home}/`))?.group ?? ''])])
  const nav: NavGroup[] = groups.map(group => ({
    title: group.label,
    collapsible: Boolean(group.label),
    defaultOpen: OPEN.has(group.label ?? ''),
    items: group.items.map(item => ({ to: item.href, label: item.label, icon: iconOf(item.icon), // A single product lists pages below its home (pharmacy/new-sale): its home is current only at its own address.
      end: item.href === '/provider' || (product !== 'ehr' && item.href === `/provider/${info.home}`) })),
  }))
  const tabsFor = (path: string) => listed.find(page => page.path === path || page.path === `${path}/*`)
  const tab = (path: string, label: string, fallback: NavItem) => { const page = tabsFor(path); return page ? { to: pageHrefOf(page), label, icon: iconOf(page.icon) } : fallback }
  const home: NavItem = product === 'ehr' ? { to: '/provider', label: 'Home', icon: House, end: true }
    : { to: `/provider/${info.home}`, label: info.name, icon: info.icon }
  const facilityTab: NavItem = { to: '/provider/institutions', label: 'Facility', icon: Hospital }

  return (
    <BluePagesProvider value={BLUE_PAGES}><OpenPagesProvider value={allowed}>
      <AttentionProvider facilityId={facility?.id} permissions={permissions}>
        <EhrAppShell className="hid-ehr-host" sidebar={null} topBar={null}>
          <AppShell
            mainAs="div"
            wide
            brand={<a href="/provider" onClick={event => { event.preventDefault(); navigate('/provider') }} className="inline-flex items-center gap-2.5 no-underline" aria-label={`Health ID ${info.name} home`}>
              <BrandLogo className="h-7 w-auto" /><Badge tone="brand" size="sm">{info.name}</Badge></a>}
            switcher={{
              name: facility?.name ?? `Health ID ${info.name}`,
              subtitle: `${roles}${isDemoFacility(facility?.id) ? ' · Demo facility' : ''}`,
              avatar: <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-fill text-white"><info.icon className="size-5" /></span>,
              menu: close => <ul className="m-0 list-none p-0">
                {session.actor.facilities.map(f => <li key={f.id}><button type="button" onClick={() => { close(); if (f.id !== facility?.id) navigate('/provider/institutions') }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-sm text-ink hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>{f.id === facility?.id && <Check className="size-4 text-brand" aria-hidden />}</button></li>)}
                <li><button type="button" onClick={() => { close(); setSamplePanel('profile') }} className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-sm text-ink-2 hover:bg-hover"><UserRound className="size-4" aria-hidden />My profile</button></li>
              </ul>,
            }}
            nav={nav}
            person={{ name, detail: session.actor.email ?? roles }}
            onSignOut={() => { void signOut().catch(() => undefined) }}
            headerStart={<>
              <a href="/provider" onClick={event => { event.preventDefault(); navigate('/provider') }} className="inline-flex no-underline lg:hidden" aria-label={`Health ID ${info.name} home`}><BrandLogo className="h-7 w-auto" /></a>
              <span className="hidden min-w-0 items-center gap-2 text-sm text-ink-3 lg:inline-flex"><Hospital className="size-4" aria-hidden /><span className="truncate font-medium text-ink">{facility?.name}</span>{isDemoFacility(facility?.id) ? <DemoChip facility={facility?.name ?? 'This facility'} /> : null}</span>
            </>}
            headerActions={<div className="hid-ehr-host-actions flex items-center gap-2"><WorkspaceSearch pages={listed} /><NotificationsButton /></div>}
            tabs={product === 'ehr' ? [home, tab('patients', 'Patients', home), tab('clinical', 'Consult', home)]
              : [home, tab('staff', 'Staff', facilityTab), tab('audit', 'Audit', facilityTab)]}
            create={product !== 'ehr' ? undefined : { label: 'Start', items: [
              ...(tabsFor('patients') ? [{ to: '/provider/patients', label: 'Find a patient', hint: 'By Health ID, with their approval', icon: Search, main: true }] : []),
              ...(tabsFor('registration') ? [{ to: '/provider/registration', label: 'Register a patient', hint: 'New Health ID at the front desk', icon: UserPlus }] : []),
              ...(tabsFor('triage/*') || tabsFor('triage') ? [{ to: '/provider/triage', label: 'Record vitals', hint: 'Triage and observations', icon: Activity }] : []),
              ...(tabsFor('requests/*') || tabsFor('requests') ? [{ to: '/provider/requests', label: 'Request record access', hint: 'From another facility', icon: ShieldCheck }] : []),
            ] }}
          >
            <div ref={pageRef} className="hid-ehr-blue-page">
              <ReviewBanner />
              <BillingBanner />
              {tabs.length > 0 ? (
                <EhrModuleTabs
                  label={tabs[0]!.label}
                  currentId={basePath(match!.page.path)}
                  tabs={tabs.filter((tab, index) => index > 0 || tab.ownTab !== false)
                    .map(tab => ({ id: basePath(tab.path), label: tab === tabs[0] ? tab.tabLabel ?? tab.label : tab.label, href: pageHrefOf(tab) }))}
                  onNavigate={follow}
                />
              ) : null}
              {/* A page that fails would take the frame with it, and the account menu's way back to the classic EHR. */}
              <BluePageBoundary key={match?.page.keepsState ? match.page.path : location.pathname}>{content}</BluePageBoundary>
            </div>
            {/* Fictional figures: only where the page itself is a sample. */}
            {match?.page.status === 'sample' ? <ConnectionStatus /> : null}
            <AccountSamplePanel panel={samplePanel} onClose={() => setSamplePanel(null)} />
          </AppShell>
        </EhrAppShell>
      </AttentionProvider>
    </OpenPagesProvider></BluePagesProvider>
  )
}
