import { createElement, isValidElement, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { EhrAppShell, EhrEmptyState, EhrIcon, EhrModuleTabs, EhrPageHeading, EhrSidebar, EhrTopBar, type EhrNavGroup,
  type EhrNavItem } from '@hid/ui/ehr'
import { useStaff } from '../../staff/App'
import { visibleNavigation } from '../../staff/navigation'
import { ReviewBanner } from '../../staff/routes/ReviewBanner'
import { BillingBanner } from '../../staff/routes/Billing'
import { BrandLogo } from '../../BrandLogo'
import { useFocusOnPageChange } from '../../pageFocus'
import { otherStaffSites, servedHere, siteElsewhere, siteHref, siteOf, SITE_NAMES, type Site } from '../../productSites'
import { chooseClassicEhr, demoFacilitySite, isDemoFacility } from '../blueFacilities'
import { BLUE_PAGES, isLiveOnlyPath, liveOnlyTitle, matchBluePage, movedAddress, pageAllowed, pageTabs } from '../routes'
import { AttentionProvider } from './attention'
import { BluePageBoundary } from './BluePageBoundary'
import { ConnectionStatus } from './ConnectionStatus'
import { DeniedPage, LivePage, UnknownPage } from './LivePages'
import { BluePageProvider, BluePagesProvider, OpenPagesProvider } from './pageContext'
import { basePath, pageHrefOf } from './pageHref'
import { TODAY_PATHS } from './pages'
import { AccountMenu, AccountSamplePanel, DemoChip, NotificationsButton, WorkspaceSearch } from './TopBarParts'
import type { EhrBluePage } from './types'

/** The sidebar: the pages the facility may open, by group, in order; a lone page named as its group gets no heading. */
export function navigationGroups(pages: readonly EhrBluePage[]): EhrNavGroup[] {
  const groups: { id: string; label: string; items: EhrNavItem[] }[] = []
  for (const page of pages) {
    let group = groups.find(candidate => candidate.label === page.group)
    if (!group) {
      group = { id: page.group || 'home', label: page.group, items: [] }
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
 * The sidebar's links to the other Health ID sites that serve pages the facility may open (productSites.ts): each
 * product is on its own site. Sample pages are the hospital EHR's design, not a reason to link to it.
 */
export function otherSitesGroup(pages: readonly EhrBluePage[]): EhrNavGroup | null {
  const sites = otherStaffSites(pages.filter(page => page.status !== 'sample').map(pageHrefOf))
  return sites.length === 0 ? null : {
    id: 'other-sites',
    label: 'Other Health ID sites',
    items: sites.map(site => ({ id: `site:${site.key}`, label: SITE_NAMES[site.key], href: siteHref(site),
      icon: createElement(EhrIcon, { name: 'share' }) })),
  }
}

/**
 * A demo facility opened on another staff site than its own: it works on its own site, where the person signs in again
 * (each site keeps its own sign-in). Nothing opens here; Choose workspace switches to another facility.
 */
function FacilityOnAnotherSite({ facility, site, choosing }: { facility: string; site: Site; choosing: boolean }) {
  return <>
    <EhrPageHeading title={`${facility} works on ${SITE_NAMES[site.key]}`} />
    <EhrEmptyState title={`${facility} is on ${site.hostname}`}
      message={`You sign in there separately.${choosing ? ' To work at another facility here, choose it.' : ''}`}
      action={<>
        <a className="hid-ehr-button" href={siteHref(site)}>Open {SITE_NAMES[site.key]}</a>
        {choosing ? <Link className="hid-ehr-button hid-ehr-button-secondary" to="/provider/institutions">Choose workspace</Link> : null}
      </>} />
  </>
}

/**
 * Today's pages that send a request before they refuse (Access requests reads the requests; Clinical record looks up
 * the patient, consent and encounters): without the permission, the frame refuses for them instead.
 */
const READS_BEFORE_REFUSING: ReadonlySet<string> = new Set(['requests', 'clinical'])

/**
 * The blue Hospital EHR's frame: EhrAppShell with the design's sidebar and top bar, and the page
 * the address opens. Session, sign-out and facility switch are today's (useStaff). A page another folder exports
 * replaces the frame's stand-in for its path; an address no page takes says so.
 */
export function BlueFrame() {
  const { state, lock } = useStaff()
  const location = useLocation()
  const navigate = useNavigate()
  const pageRef = useRef<HTMLDivElement>(null)
  const [samplePanel, setSamplePanel] = useState<'profile' | 'preferences' | 'help' | null>(null)
  useFocusOnPageChange(pageRef, lock !== null)
  const session = state.status === 'ready' ? state.session : null
  const facility = session?.actor.facility
  const permissions = useMemo(() => facility?.permissions ?? [], [facility])
  const allowed = useMemo(() => BLUE_PAGES.filter(page => pageAllowed(page, session)), [session])
  // What the sidebar and search offer: the allowed pages this session lists, on this site (productSites.ts).
  const listed = useMemo(() => allowed.filter(page => (!session || (page.listed?.(session) ?? true))
    && servedHere(pageHrefOf(page))), [allowed, session])
  const otherSites = useMemo(() => otherSitesGroup(allowed), [allowed])
  const demoSite = demoFacilitySite(facility?.id)
  const facilitySite = demoSite ? siteElsewhere(demoSite) : null
  const match = matchBluePage(BLUE_PAGES, location.pathname)
  const tabs = match ? pageTabs(allowed, match.page) : []
  // A tab has no sidebar entry: the page it joins is the current one.
  const current = match?.page.tabOf ? allowed.find(page => basePath(page.path) === match.page.tabOf) ?? match.page : match?.page
  const shownTitle = match ? match.page.label : liveOnlyTitle(location.pathname) ?? 'Page not found'
  // Today's tab title names today's pages only: the blue page names itself once the workspace is open.
  useEffect(() => {
    if (lock === null && session) document.title = `${shownTitle} · Health ID EHR`
  }, [shownTitle, lock, session])
  if (!session) return null
  const moved = movedAddress(location.pathname)
  if (moved) return <Navigate replace to={{ pathname: moved, search: location.search, hash: location.hash }} />

  const follow = (item: { href: string }, event: MouseEvent<HTMLAnchorElement>) => {
    // Another site's address is the browser's to open.
    if (/^https:/.test(item.href)) return
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    navigate(item.href)
  }

  const classicEhr = () => {
    // Today's workspace serves its own pages at the same address, and only at that exact address: a record or a sample
    // under one (/provider/appointments/5a020001) is not one of today's, so it opens on today's Overview.
    // So does a page today's sidebar lists for this facility: Staff, at a facility that signed itself up (Novu).
    const path = location.pathname.replace(/\/+$/, '').toLowerCase()
    const today = [...TODAY_PATHS].some(base => path === `/provider/${base}`) || isLiveOnlyPath(path)
      || visibleNavigation(facility).some(item => item.to === path)
    if (!today) navigate('/provider')
    chooseClassicEhr()
  }

  // Today's page refuses in its own words ("Laboratory unavailable"), and reads nothing without the permission.
  const shownHere = match === null || (match.page.visible?.(session) ?? true)
  const todayRefuses = match !== null && match.page.status === 'live' && isValidElement(match.page.element)
    && match.page.element.type === LivePage && shownHere && !READS_BEFORE_REFUSING.has(basePath(match.page.path))
  const content = facilitySite
    ? <FacilityOnAnotherSite facility={facility?.name ?? 'This facility'} site={facilitySite} choosing={session.actor.facilities.length > 1} />
    : match
    ? pageAllowed(match.page, session) || todayRefuses
      ? <BluePageProvider value={match}>{match.page.element}</BluePageProvider>
      : match.page.refusal ?? <DeniedPage label={match.page.label} facility={facility?.name ?? 'this facility'}
        reason={shownHere ? 'permission' : 'not-here'} />
    : isLiveOnlyPath(location.pathname) ? <LivePage /> : <UnknownPage />

  return (
    <BluePagesProvider value={BLUE_PAGES}><OpenPagesProvider value={allowed}>
      <AttentionProvider facilityId={facility?.id} permissions={permissions}>
        <EhrAppShell
          // While the session is checked, today's lock screen stands in for the page, as today's <main> hides.
          mainHidden={lock !== null}
          sidebar={(
            <EhrSidebar
              groups={[...navigationGroups(listed.filter(page => !page.tabOf)), ...(otherSites ? [otherSites] : [])]}
              currentId={current?.path}
              brand={<BrandLogo className="hid-ehr-blue-logo" />}
              product={SITE_NAMES[siteOf(window.location.hostname)?.key ?? 'ehr']}
              onNavigate={follow}
            />
          )}
          topBar={(
            <EhrTopBar
              start={<strong className="hid-ehr-blue-facility">{facility?.name ?? 'Health ID EHR'}</strong>}
              end={<>
                <WorkspaceSearch pages={listed} />
                {isDemoFacility(facility?.id) ? <DemoChip facility={facility?.name ?? 'This facility'} /> : null}
                <NotificationsButton />
                <AccountMenu onSample={setSamplePanel} onClassic={classicEhr} />
              </>}
            />
          )}
        >
          <div ref={pageRef} className="hid-ehr-blue-page">
            <ReviewBanner />
            <BillingBanner />
            {tabs.length > 0 ? (
              <EhrModuleTabs
                label={tabs[0]!.label}
                currentId={basePath(match!.page.path)}
                tabs={tabs.map((tab, index) => ({ id: basePath(tab.path), label: index === 0 ? tab.tabLabel ?? tab.label : tab.label, href: pageHrefOf(tab) }))}
                onNavigate={follow}
              />
            ) : null}
            {/* A page that fails would take the frame with it, and the account menu's way back to the classic EHR. */}
            <BluePageBoundary key={location.pathname} onClassic={classicEhr}>{content}</BluePageBoundary>
          </div>
          {/* Fictional figures: only where the page itself is a sample. */}
          {match?.page.status === 'sample' ? <ConnectionStatus /> : null}
          <AccountSamplePanel panel={samplePanel} onClose={() => setSamplePanel(null)} />
        </EhrAppShell>
      </AttentionProvider>
    </OpenPagesProvider></BluePagesProvider>
  )
}
