import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { EhrAppShell, EhrModuleTabs, type EhrNavGroup, type EhrNavItem } from '@hid/ui/ehr'
import { Activity, ArrowLeft, Check, ExternalLink, Hospital, House, Search, ShieldCheck, ShieldX, UserPlus, UserRound } from 'lucide-react'
import { AppShell, type NavGroup, type NavItem } from '../../kasuwa/AppShell'
import { Alert, Badge, Button, cx, EmptyState, type Icon } from '../../kasuwa/ui'
import { useStaff } from '../../staff/App'
import { ReviewBanner } from '../../staff/routes/ReviewBanner'
import { BillingBanner } from '../../staff/routes/Billing'
import { BrandLogo } from '../../BrandLogo'
import { useFocusOnPageChange } from '../../pageFocus'
import { otherStaffSites, ownProductPage, siteElsewhere, siteOf, SITE_NAMES, type Site } from '../../productSites'
import { switchArrival, switchHref, switchingOn, type SwitchArrival } from '../../siteSwitch'
import { demoFacilitySite, isDemoFacility } from '../blueFacilities'
import { PRODUCTS, inProduct, productOf } from './product'
import { BLUE_PAGES, isLiveOnlyPath, liveOnlyTitle, matchBluePage, movedAddress, pageAllowed, pageTabs } from '../routes'
import { productUsable } from './pageAccess'
import { AttentionProvider } from './attention'
import { BluePageBoundary } from './BluePageBoundary'
import { ConnectionStatus } from './ConnectionStatus'
import { DeniedPage, LivePage } from './LivePages'
import { BluePageProvider, BluePagesProvider, OpenPagesProvider } from './pageContext'
import { basePath, pageHrefOf } from './pageHref'
import { TODAY_PAGES } from './pages'
import { DENIED_NOTICE, RedirectNotice } from './RedirectNotice'
import { useRoleView } from './roleView'
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
 * The sidebar's links to the other Health ID sites that serve live pages this session may open (productSites.ts): each
 * product is on its own site. Sample pages are the hospital EHR's design, not a reason to link to it. None on a host
 * that is not a Health ID site, which serves every page. With single sign-on on, each link says which site and page it
 * leaves (siteSwitch.ts switchHref: `backPath`, when it passes the check); off, it is today's siteHref.
 */
export function otherSitesGroup(pages: readonly EhrBluePage[], backPath: string | null = null): NavGroup | null {
  const hostname = window.location.hostname
  const sites = otherStaffSites(pages.filter(page => page.status !== 'sample').map(pageHrefOf), hostname)
  return sites.length === 0 ? null : {
    title: 'Other Health ID sites',
    collapsible: true,
    defaultOpen: true,
    items: sites.map(site => ({ to: switchHref(site, hostname, backPath), label: SITE_NAMES[site.key], icon: ExternalLink, external: true })),
  }
}

/**
 * The page a link to another site says this one is: the blue page's own address, without anything below it (a record's
 * id stays here), else the address itself. siteSwitch.ts checks it again before any link carries it.
 */
function switchBackPath(pathname: string, page: EhrBluePage | null): string {
  return page ? pageHrefOf(page) : pathname
}

/**
 * A demo facility opened on another staff site than its own: it works on its own site, where the person signs in again
 * (each site keeps its own sign-in). Nothing opens here; Facility switches to another facility.
 */
function FacilityOnAnotherSite({ facility, site, href, choosing }: { facility: string; site: Site; href: string; choosing: boolean }) {
  return <EmptyState titleAs="h1" icon={ExternalLink} title={`${facility} works on ${SITE_NAMES[site.key]}`}
    description={`${facility} is on ${site.hostname}, where you sign in separately.${choosing ? ' To work at another facility here, choose it.' : ''}`}
    action={<div className="flex flex-wrap justify-center gap-2">
      <Button href={href} variant="primary">Open {SITE_NAMES[site.key]}</Button>
      {choosing ? <Button to="/provider/institutions">Choose workspace</Button> : null}
    </div>} />
}

/** "Back to <site>" after a switch (siteSwitch.ts): the page left, on that site's own hostname. */
function SwitchBackLink({ arrival }: { arrival: SwitchArrival }) {
  return <a href={arrival.href} className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-brand-ink no-underline hover:underline">
    <ArrowLeft className="size-4 shrink-0" aria-hidden /><span className="truncate">Back to {arrival.name}</span></a>
}

/**
 * Signed in, at a facility whose roles give this person nothing of this site's product (pageAccess.ts productUsable):
 * the page says so, and offers the way back to the site they came from, never a sign-in. The pages every staff site
 * serves (staff, audit, subscription) still open from the sidebar where the roles allow them.
 */
function ProductNotForAccount({ product, facility, arrival, choosing }: { product: string; facility: string; arrival: SwitchArrival | null; choosing: boolean }) {
  return <EmptyState titleAs="h1" icon={ShieldX} title={`Your account can't use ${product} at this facility.`}
    description={`You are signed in, but your role at ${facility} does not include ${product}. An administrator at ${facility} can give you access.${choosing ? ' To work at another facility, choose it.' : ''}`}
    action={arrival || choosing ? <div className="flex flex-wrap justify-center gap-2">
      {arrival ? <Button href={arrival.href} variant="primary">Back to {arrival.name}</Button> : null}
      {choosing ? <Button to="/provider/institutions">Choose workspace</Button> : null}
    </div> : undefined} />
}

/**
 * Today's pages that send a request before they refuse (Access requests reads the requests; Clinical record looks up
 * the patient, consent and encounters): without the permission, the frame refuses for them instead.
 */
const READS_BEFORE_REFUSING: ReadonlySet<string> = new Set(['requests', 'clinical'])

/**
 * The blue Hospital EHR's frame: EhrAppShell with the design's sidebar and top bar, and the page
 * the address opens. Session, sign-out and facility switch are today's (useStaff). A page another folder exports
 * replaces the frame's stand-in for its path. An address no page takes opens Home, and so does a page this session may
 * not open, with a note saying why (the design's admin/unknown-route and denied-route-redirect).
 */
export function BlueFrame() {
  const { state, lock, signOut } = useStaff()
  const location = useLocation()
  const navigate = useNavigate()
  const pageRef = useRef<HTMLDivElement>(null)
  const [samplePanel, setSamplePanel] = useState<'profile' | 'preferences' | 'help' | null>(null)
  // Today's sign-out: a refusal is said, and the session stays, as the account menu said it.
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const { viewing } = useRoleView()
  useFocusOnPageChange(pageRef, lock !== null)
  const session = state.status === 'ready' ? state.session : null
  const facility = session?.actor.facility
  const permissions = useMemo(() => facility?.permissions ?? [], [facility])
  // A sample page opens to the design roles of the person, or of the demo role whose Home is being viewed.
  const allowed = useMemo(() => BLUE_PAGES.filter(page => pageAllowed(page, session, viewing)), [session, viewing])
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
  // With single sign-on on, a staff site whose product this session may not use at its facility says so on the
  // product's own pages and Home, in place of each page's refusal (siteSwitch.ts, pageAccess.ts productUsable).
  const hostname = window.location.hostname
  const here = siteOf(hostname)
  const cannotUse = switchingOn() && session !== null && here !== null
    && (/^\/provider\/?$/.test(location.pathname) || ownProductPage(location.pathname, hostname))
    && !productUsable(BLUE_PAGES, session, hostname)
  const shownTitle = cannotUse ? 'No access' : match ? match.page.label : liveOnlyTitle(location.pathname) ?? 'Page not found'
  // Today's tab title names today's pages only: the blue page names itself once the workspace is open.
  useEffect(() => {
    if (lock === null && session) document.title = `${shownTitle} · Health ID ${info.name}`
  }, [shownTitle, lock, session, info.name])
  if (!session) return null
  const moved = movedAddress(location.pathname)
  if (moved) return <Navigate replace to={{ pathname: moved, search: location.search, hash: location.hash }} />
  // A single product's home is its own queue.
  if (product !== 'ehr' && /^\/provider\/?$/.test(location.pathname)) return <Navigate replace to={{ pathname: `/provider/${info.home}`, search: location.search }} />

  function leave() {
    if (signingOut) return
    setSignOutError('')
    setSigningOut(true)
    signOut()
      .catch((caught: unknown) => setSignOutError(caught instanceof Error ? caught.message : 'Sign-out could not be completed.'))
      .finally(() => setSigningOut(false))
  }

  const follow = (item: { href: string }, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    navigate(item.href)
  }


  // Today's page refuses in its own words ("Laboratory unavailable"), and reads nothing without the permission.
  const shownHere = match === null || (match.page.visible?.(session) ?? true)
  const todayRefuses = match !== null && TODAY_PAGES.has(match.page) && shownHere
    && !READS_BEFORE_REFUSING.has(basePath(match.page.path))
  // A demo facility works on its own site (productSites.ts): opened on another, the page says so and opens nothing.
  const demoSite = demoFacilitySite(facility?.id)
  const facilitySite = demoSite ? siteElsewhere(demoSite) : null
  const backPath = switchBackPath(location.pathname, match?.page ?? null)
  const arrival = switchArrival()
  const content = facilitySite
    ? <FacilityOnAnotherSite facility={facility?.name ?? 'This facility'} site={facilitySite} href={switchHref(facilitySite, hostname, backPath)}
      choosing={session.actor.facilities.length > 1} />
    : cannotUse && here
    ? <ProductNotForAccount product={SITE_NAMES[here.key]} facility={facility?.name ?? 'this facility'} arrival={arrival}
      choosing={session.actor.facilities.length > 1} />
    : match
    ? pageAllowed(match.page, session, viewing) || todayRefuses
      ? <BluePageProvider value={match}>{match.page.element}</BluePageProvider>
      : match.page.refusal ?? (shownHere
        ? <Navigate replace to="/provider" state={{ frameNotice: DENIED_NOTICE }} />
        : <DeniedPage label={match.page.label} facility={facility?.name ?? 'this facility'} />)
    : isLiveOnlyPath(location.pathname) ? <LivePage /> : <Navigate replace to="/provider" />

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
  // Each product on its own site: the other sites that serve the rest of what this session may open.
  const otherSites = otherSitesGroup(allowed, backPath)
  if (otherSites) nav.push(otherSites)
  const tabsFor = (path: string) => listed.find(page => page.path === path || page.path === `${path}/*`)
  const tab = (path: string, label: string, fallback: NavItem) => { const page = tabsFor(path); return page ? { to: pageHrefOf(page), label, icon: iconOf(page.icon) } : fallback }
  const home: NavItem = product === 'ehr' ? { to: '/provider', label: 'Home', icon: House, end: true }
    : { to: `/provider/${info.home}`, label: info.name, icon: info.icon }
  const facilityTab: NavItem = { to: '/provider/institutions', label: 'Facility', icon: Hospital }

  return (
    <BluePagesProvider value={BLUE_PAGES}><OpenPagesProvider value={allowed}>
      <AttentionProvider facilityId={facility?.id} permissions={permissions}>
        <EhrAppShell className="hid-ehr-host" sidebar={null} topBar={null}
          // While the session is checked, today's lock screen stands in for the page, as today's <main> hides.
          mainHidden={lock !== null}>
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
            onSignOut={leave}
            signingOut={signingOut}
            headerStart={<>
              <a href="/provider" onClick={event => { event.preventDefault(); navigate('/provider') }} className="inline-flex no-underline lg:hidden" aria-label={`Health ID ${info.name} home`}><BrandLogo className="h-7 w-auto" /></a>
              {arrival ? <SwitchBackLink arrival={arrival} /> : null}
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
            <div ref={pageRef} className="hid-ehr-blue-page @container">
              {signOutError ? <Alert intent="error" title="Couldn’t sign out">{signOutError}</Alert> : null}
              <RedirectNotice />
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
