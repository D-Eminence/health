import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Navigate, Route, Routes, UNSAFE_RouteContext, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { EhrAppShell, EhrModuleTabs, type EhrNavGroup, type EhrNavItem } from '@hid/ui/ehr'
import { Activity, ArrowLeft, Check, ExternalLink, Hospital, House, Search, ShieldCheck, ShieldX, UserPlus, UserRound } from 'lucide-react'
import { AppShell, type NavGroup, type NavItem } from '../../kasuwa/AppShell'
import { Alert, Badge, Button, cx, EmptyState, type Icon } from '../../kasuwa/ui'
import { useStaff } from '../../staff/App'
import type { StaffSession } from '../../staff/api'
import { FacilityCheckCard, ReviewBanner } from '../../staff/routes/ReviewBanner'
import { BillingBanner } from '../../staff/routes/Billing'
import { roleNames, selfServiceReview } from '../../staff/staffAccess'
import { BrandLogo } from '../../BrandLogo'
import { useFocusOnPageChange } from '../../pageFocus'
import { otherStaffSites, ownProductPage, siteElsewhere, siteOf, SITE_NAMES, SITE_PRODUCT_NAMES, type Site } from '../../productSites'
import { switchArrival, switchHref, switchingOn, type SwitchArrival } from '../../siteSwitch'
import { demoFacilitySite, isDemoFacility } from '../blueFacilities'
import { PRODUCTS, opensInProduct, productHere, productLists, type Product } from './product'
import { BLUE_PAGES, liveOnlyTitle, matchBluePage, movedAddress, pageAllowed, pageTabs, pageUsable } from '../routes'
import { productUsable } from './pageAccess'
import { AttentionProvider } from './attention'
import { BluePageBoundary } from './BluePageBoundary'
import { facilityRefusal } from './ChooseWorkspace'
import { ConnectionStatus } from './ConnectionStatus'
import { DeniedPage, LivePage } from './LivePages'
import { NotFoundPage } from './NotFoundPage'
import { BluePageProvider, BluePagesProvider, OpenPagesProvider, TodayPageProvider } from './pageContext'
import { basePath, pageHrefOf } from './pageHref'
import { TODAY_PAGES } from './pages'
import { DENIED_NOTICE, RedirectNotice } from './RedirectNotice'
import { useRoleView } from './roleView'
import { AccountSamplePanel, DemoChip, NotificationsButton, WorkspaceSearch } from './TopBarParts'
import type { EhrBluePage } from './types'
import { PLAIN, plainErrorText } from '@hid/http'

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

/**
 * A single product keeps only Patients and Access requests of the clinical pages (product.ts): they share one plain
 * heading there, as the classic portal listed them, not the hospital's front desk and care.
 */
const PRODUCT_CLINICAL_HEADING = 'Patients'

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

/** The heading a page is listed under in the sidebar, in this product's workspace. */
export function sidebarGroupOf(page: Pick<EhrBluePage, 'path' | 'group'>, product: Product = 'ehr'): string {
  if (page.group !== 'Clinical') return page.group
  return product === 'ehr' ? CLINICAL_SIDEBAR[basePath(page.path)] ?? page.group : PRODUCT_CLINICAL_HEADING
}

/** The sidebar: the pages the facility may open, by group, in order; a lone page named as its group gets no heading. */
export function navigationGroups(pages: readonly EhrBluePage[], product: Product = 'ehr'): EhrNavGroup[] {
  const groups: { id: string; label: string; items: EhrNavItem[] }[] = []
  for (const page of pages) {
    const label = sidebarGroupOf(page, product)
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
 * product is on its own site, and only another product's own pages are served elsewhere. A product site keeps the
 * hospital EHR's pages and opens its own Home in their place, so it never links to the EHR site. Sample pages are the
 * hospital EHR's design, not a reason to link anywhere. `pages` are the pages this session can use (pageUsable), not
 * every address it may open: Pharmacy's own address opens for everyone and only sends on to its pages, so it is no
 * reason to link to the Pharmacy's site for a role that may open none of them. None on a host that is not a Health ID
 * site, which serves every page. With single sign-on on, each link says which site and page it leaves (siteSwitch.ts
 * switchHref: `backPath`, when it passes the check); off, it is today's siteHref. The only link from a product site to
 * the EHR site is Demo Hospital's "Open Hospital EHR" button below (FacilityOnAnotherSite): the owner's one named
 * exception, demo only (2 Nov 2026, productSites.ts). This group never adds one.
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
 * Of the other sites the sidebar links to, those whose product this session may use at its facility (pageAccess.ts
 * productUsable): a site listed only for a page that asks for nothing (the pharmacy's menu) is left out.
 */
function usableSites(pages: readonly EhrBluePage[], session: StaffSession, hostname: string, backPath: string | null): UsableSite[] {
  return otherStaffSites(pages.filter(page => page.status !== 'sample').map(pageHrefOf), hostname)
    .filter(site => productUsable(BLUE_PAGES, session, site.hostname))
    .map(site => ({ key: site.key, name: SITE_NAMES[site.key], href: switchHref(site, hostname, backPath) }))
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
 * (each site keeps its own sign-in). Nothing opens here; Facility switches to another facility. With single sign-on on,
 * that site signs them in through the sign-in site they already used, so the page no longer warns of a second sign-in.
 * For Demo Hospital on the Lab or Migrate site its button is "Open Hospital EHR": the owner's one named cross-site
 * exception, demo only (2 Nov 2026, productSites.ts). Real facilities never reach this page (demoFacilitySite is null
 * for them).
 */
function FacilityOnAnotherSite({ facility, site, href, choosing }: { facility: string; site: Site; href: string; choosing: boolean }) {
  const where = switchingOn() ? `${facility} is on ${SITE_PRODUCT_NAMES[site.key]}.`
    : `${facility} is on ${SITE_PRODUCT_NAMES[site.key]}, where you sign in separately.`
  return <EmptyState titleAs="h1" icon={ExternalLink} title={`${facility} works on ${SITE_NAMES[site.key]}`}
    description={`${where}${choosing ? ' To work at another facility here, choose it.' : ''}`}
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

/** Another staff site this session may use, as a link to it (siteSwitch.ts switchHref). */
interface UsableSite { readonly key: Site['key']; readonly name: string; readonly href: string }

/**
 * Signed in, at a facility whose roles give this person nothing of this site's product (pageAccess.ts productUsable):
 * the page says so, and offers the way back to the site they came from, never a sign-in. Without one in memory (an
 * address typed, the sign-in hand-off's round trip, which leaves the page, or an arrival from the EHR site, which a
 * product's site never links back to), it offers the other staff sites whose product the same roles do open (a
 * product's site never links to the EHR site, #113), or none. The pages every staff site serves (staff, audit,
 * subscription) still open from the sidebar where the roles allow them.
 */
function ProductNotForAccount({ product, facility, arrival, usable, choosing }: {
  product: string; facility: string; arrival: SwitchArrival | null; usable: readonly UsableSite[]; choosing: boolean
}) {
  const onward = arrival ? [] : usable
  return <EmptyState titleAs="h1" icon={ShieldX} title={`Your account can't use ${product} at this facility.`}
    description={`You are signed in, but your role at ${facility} does not include ${product}. An administrator at ${facility} can give you access.${choosing ? ' To work at another facility, choose it.' : ''}`}
    action={arrival || onward.length > 0 || choosing ? <div className="flex flex-wrap justify-center gap-2">
      {arrival ? <Button href={arrival.href} variant="primary">Back to {arrival.name}</Button> : null}
      {onward.map((site, index) => <Button key={site.key} href={site.href} variant={index === 0 ? 'primary' : undefined}>Open {site.name}</Button>)}
      {choosing ? <Button to="/provider/institutions">Choose workspace</Button> : null}
    </div> : undefined} />
}

/**
 * Where a page's own routes start: no parent route. The blue EHR is mounted inside today's pathless Shell route, and
 * react-router warns about every <Routes> below a parent route without a trailing "*" (a page's own, or the frame's).
 */
const NO_PARENT_ROUTE = { outlet: null, matches: [], isDataRoute: false }

/**
 * Today's pages that send a request before they refuse (Access requests reads the requests; Clinical record looks up
 * the patient, consent and encounters): without the permission, the frame refuses for them instead.
 */
const READS_BEFORE_REFUSING: ReadonlySet<string> = new Set(['requests', 'clinical'])

/**
 * The blue Hospital EHR's frame: EhrAppShell with the design's sidebar and top bar, and the page
 * the address opens. Session, sign-out and facility switch are today's (useStaff). A page another folder exports
 * replaces the frame's stand-in for its path. A page this session may not open sends it Home, with a note saying why
 * (the design's denied-route-redirect); an address no page takes says "Page not found", as today's portal does.
 */
export function BlueFrame() {
  const { state, lock, signOut, selectFacility, activePatient } = useStaff()
  const location = useLocation()
  const navigate = useNavigate()
  // Today's page for this address, which a live stand-in shows.
  const todayPage = useOutlet()
  const pageRef = useRef<HTMLDivElement>(null)
  const [samplePanel, setSamplePanel] = useState<'profile' | 'preferences' | 'help' | null>(null)
  // Today's sign-out: a refusal is said, and the session stays, as the account menu said it.
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  // Switching facility from the account menu: one step, as Choose workspace's own button (an open patient asks first).
  const [switchError, setSwitchError] = useState('')
  // The facility being opened: one switch at a time, as Choose workspace's own buttons wait for theirs.
  const [switching, setSwitching] = useState<string | null>(null)
  const { viewing } = useRoleView()
  useFocusOnPageChange(pageRef, lock !== null)
  // A refused switch is said where it was tried: another page opened leaves it behind.
  useEffect(() => setSwitchError(''), [location.pathname])
  const session = state.status === 'ready' ? state.session : null
  const facility = session?.actor.facility
  const permissions = useMemo(() => facility?.permissions ?? [], [facility])
  // A sample page opens to the design roles of the person, or of the demo role whose Home is being viewed.
  const allowed = useMemo(() => BLUE_PAGES.filter(page => pageAllowed(page, session, viewing)), [session, viewing])
  // What the sidebar and search offer: the allowed pages this session lists.
  // Only working screens are offered (the owner's decision of 2026-10-31): sample modules with fictional figures stay in
  // the code for demos but are not listed in the sidebar or search.
  // A lab, pharmacy or outreach on its own sees its own pages, the facility's, and Patients and Access requests
  // (product.ts); a hospital's EHR has them all.
  const product = productHere(session)
  const info = PRODUCTS[product]
  // Whether this session may open a single product's own page (its queue). When it may not, Home (the Overview) is its
  // home instead, as today's portal lands there (staff/navigation.ts staffLandingPath): the product's page would only
  // refuse. So Home is always listed in the EHR, and in a single product only then, where /provider lands.
  const ownPage = product === 'ehr' ? undefined : BLUE_PAGES.find(page => basePath(page.path) === info.home)
  const ownPageOpen = ownPage !== undefined && pageAllowed(ownPage, session, viewing)
  const listed = useMemo(() => allowed.filter(page => (page.status !== 'sample' || page.path === '') && !INTERNAL_GROUPS.has(page.group)
    && (page.path === '' ? product === 'ehr' || !ownPageOpen : productLists(product, page.path))
    && (!session || (page.listed?.(session) ?? true))), [allowed, session, product, ownPageOpen])
  const match = matchBluePage(BLUE_PAGES, location.pathname)
  // A pharmacy or lab on its own lists a product's pages in the sidebar, so it draws no tabs above them as well.
  const tabs = match && product === 'ehr' ? pageTabs(allowed, match.page) : []
  // What sample links (Notifications' Recent activity, role dashboards, Facility setup) may point to: a page this product
  // opens, so none of them leads to a page the frame sends to the product's Home (below).
  const openHere = useMemo(() => allowed.filter(page => opensInProduct(product, page.path)), [allowed, product])
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
  // A single product's home is its own queue, when this session may open it; otherwise /provider stays Home.
  // The frame's notice (a page this session may not open) goes along, so it shows on the product's first page.
  if (product !== 'ehr' && ownPageOpen && /^\/provider\/?$/.test(location.pathname)) return <Navigate replace to={{ pathname: `/provider/${info.home}`, search: location.search }} state={location.state} />
  // On a single product's site, a page of the hospital EHR's (Patient registration, Consultation, a sample), typed or a
  // sign-in's return address, opens the product's Home instead (review, 2026-11-01): its menu never offers one. The
  // page never mounts, so it reads nothing, and its query stays behind with it. What the product opens unlisted
  // (product.ts) still opens; an address no page takes is left to the frame below.
  if (product !== 'ehr' && match && !opensInProduct(product, match.page.path)) return <Navigate replace to="/provider" />

  function leave() {
    if (signingOut) return
    setSignOutError('')
    setSigningOut(true)
    signOut()
      .catch((caught: unknown) => setSignOutError(plainErrorText(caught, PLAIN.signOutFailed)))
      .finally(() => setSigningOut(false))
  }

  function switchTo(id: string, name: string) {
    // An open patient record closes on a switch: Choose workspace says so before anything changes.
    if (switching) return
    if (activePatient) { navigate('/provider/institutions'); return }
    setSwitchError('')
    setSwitching(id)
    selectFacility(id)
      .then(switched => { if (switched) navigate('/provider') })
      .catch((caught: unknown) => setSwitchError(facilityRefusal(caught, name)))
      .finally(() => setSwitching(null))
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
  // The first item: Home in the EHR, and a single product's own first page. A product site whose own page this session
  // may not open leads Home instead, where it landed, rather than to a refusal.
  const home: NavItem = product === 'ehr' || !ownPageOpen ? { to: '/provider', label: 'Home', icon: House, end: true }
    : { to: `/provider/${info.home}`, label: info.name, icon: info.icon }
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
      usable={usableSites(allowed, session, hostname, backPath)} choosing={session.actor.facilities.length > 1} />
    : match
    ? pageAllowed(match.page, session, viewing) || todayRefuses
      ? <BluePageProvider value={match}>{match.page.element}</BluePageProvider>
      : match.page.refusal ?? (shownHere
        ? <Navigate replace to="/provider" state={{ frameNotice: DENIED_NOTICE }} />
        : <DeniedPage label={match.page.label} facility={facility?.name ?? 'this facility'} />)
    // Today's "Page not found", not the design's silent trip Home (admin/unknown-route). Today's own route opens only
    // where today serves it (the invitation on Novu only): elsewhere it is the frame's Page not found, not today's.
    : liveOnlyTitle(location.pathname) !== undefined ? <LivePage /> : <NotFoundPage to={home.to} label={home.label} />

  const name = session.actor.displayName ?? session.actor.email ?? 'Staff member'
  // Role names, never codes (parity report 3.1 #16): "Facility administrator, Doctor", not "org_admin, doctor".
  const roles = roleNames(facility?.roles ?? [])
  // In the EHR a page that joins another's tabs has no sidebar entry; in a single product (a pharmacy or lab on its own)
  // each is listed by its tab name ("To dispense", "New sale", "Stock").
  // A single product's own pages come first (its menu), then anything else it holds (settings, insight). Home, listed
  // there when the product's own page is not open to this session, leads both: it is where /provider landed.
  const own = (page: EhrBluePage) => basePath(page.path) === info.home || basePath(page.path).startsWith(`${info.home}/`)
  const isHome = (page: EhrBluePage) => page.path === ''
  const ordered = product === 'ehr' ? listed
    : [...listed.filter(isHome), ...listed.filter(own), ...listed.filter(page => !isHome(page) && !own(page))]
  const groups = navigationGroups(product === 'ehr' ? ordered.filter(page => !page.tabOf)
    : ordered.map(page => page.tabLabel ? { ...page, label: page.tabLabel } : page), product)
  // The groups a clinician opens all day stay open; the rest fold (Hick's Law), each opening while it holds the page.
  // A single product's own group is its whole job, so it stays open too, as do its Patients and Access requests.
  // (A pharmacy's home is a menu of pages below it, pharmacy/sell first: its group is theirs.)
  const OPEN = new Set(['Front desk', 'Care', ...(product === 'ehr' ? [] : [PRODUCT_CLINICAL_HEADING, listed.find(page => basePath(page.path) === info.home
    || basePath(page.path).startsWith(`${info.home}/`))?.group ?? ''])])
  const nav: NavGroup[] = groups.map(group => ({
    title: group.label,
    collapsible: Boolean(group.label),
    defaultOpen: OPEN.has(group.label ?? ''),
    items: group.items.map(item => ({ to: item.href, label: item.label, icon: iconOf(item.icon), // A single product lists pages below its home (pharmacy/new-sale): its home is current only at its own address.
      end: item.href === '/provider' || (product !== 'ehr' && item.href === `/provider/${info.home}`) })),
  }))
  // Each product on its own site: the other sites that serve the rest of what this session may open.
  const otherSites = otherSitesGroup(allowed.filter(page => pageUsable(page, BLUE_PAGES, session, viewing)), backPath)
  if (otherSites) nav.push(otherSites)
  const tabsFor = (path: string) => listed.find(page => page.path === path || page.path === `${path}/*`)
  const tab = (path: string, label: string, fallback: NavItem) => { const page = tabsFor(path); return page ? { to: pageHrefOf(page), label, icon: iconOf(page.icon) } : fallback }
  const facilityTab: NavItem = { to: '/provider/institutions', label: 'Facility', icon: Hospital }

  return (
    <BluePagesProvider value={BLUE_PAGES}><OpenPagesProvider value={openHere}>
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
                {session.actor.facilities.map(f => <li key={f.id}><button type="button" onClick={() => { close(); if (f.id !== facility?.id) switchTo(f.id, f.name) }} disabled={switching !== null}
                  className="flex w-full cursor-pointer disabled:cursor-wait items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-sm text-ink hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>{f.id === switching ? <span className="text-ink-3">Opening…</span> : null}{f.id === facility?.id && <Check className="size-4 text-brand" aria-hidden />}</button></li>)}
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
              // Access requests ask the patient to share their record with this facility: nothing goes to another facility.
              // Said as the page and copy.ts say it ("Ask a patient"), not "Request record access".
              ...(tabsFor('requests/*') || tabsFor('requests') ? [{ to: '/provider/requests', label: 'Ask a patient for access', hint: 'Ask a patient to share their record here', icon: ShieldCheck }] : []),
            ] }}
          >
            <div ref={pageRef} className="hid-ehr-blue-page @container">
              {signOutError ? <Alert intent="error" title="Couldn’t sign out">{signOutError}</Alert> : null}
              {switchError ? <Alert intent="error" title="That facility couldn’t be opened">{switchError}</Alert> : null}
              <RedirectNotice />
              <ReviewBanner />
              {/* A lab, pharmacy or outreach on its own may land on its own first page and never see Home's card. */}
              {/* Only above its own pages: it leaves when another page opens, and its "Done" is not shown again. While the
                  check is pending the banner above already says so, so only the "Done" card shows here. */}
              {product !== 'ehr' && facility && match && selfServiceReview(facility) !== 'pending' && (basePath(match.page.path) === info.home || basePath(match.page.path).startsWith(`${info.home}/`))
                ? <FacilityCheckCard facility={facility} /> : null}
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
              {/* A page that fails would take the frame with it: the boundary keeps the sidebar and the account menu. */}
              <BluePageBoundary key={match?.page.keepsState ? match.page.path : location.pathname}>
                {/* A page's own <Routes> resolve from its address: index is the page, "new" is <page>/new. */}
                <UNSAFE_RouteContext.Provider value={NO_PARENT_ROUTE}>
                  <Routes>
                    <Route path={match ? `${pageHrefOf(match.page)}/*` : '/provider/*'}
                      element={<TodayPageProvider value={todayPage}>{content}</TodayPageProvider>} />
                  </Routes>
                </UNSAFE_RouteContext.Provider>
              </BluePageBoundary>
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
