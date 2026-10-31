import { isValidElement, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { EhrAppShell, EhrModuleTabs, EhrSidebar, EhrTopBar, type EhrNavGroup, type EhrNavItem } from '@hid/ui/ehr'
import { useStaff } from '../../staff/App'
import { visibleNavigation } from '../../staff/navigation'
import { ReviewBanner } from '../../staff/routes/ReviewBanner'
import { BillingBanner } from '../../staff/routes/Billing'
import { BrandLogo } from '../../BrandLogo'
import { useFocusOnPageChange } from '../../pageFocus'
import { chooseClassicEhr, isDemoFacility } from '../blueFacilities'
import { BLUE_PAGES, isLiveOnlyPath, liveOnlyTitle, matchBluePage, movedAddress, pageAllowed, pageTabs } from '../routes'
import { AttentionProvider } from './attention'
import { BluePageBoundary } from './BluePageBoundary'
import { ConnectionStatus } from './ConnectionStatus'
import { DeniedPage, LivePage, UnknownPage } from './LivePages'
import { BluePageProvider, BluePagesProvider, OpenPagesProvider } from './pageContext'
import { basePath, pageHrefOf } from './pageHref'
import { TODAY_PATHS } from './pages'
import { AccountMenu, AccountSamplePanel, DemoChip, NotificationsButton, WorkspaceSearch } from './TopBarParts'
import { SupportChatDrawer, supportChatOffered } from './support/BlueSupportChat'
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
  // What the sidebar and search offer: the allowed pages this session lists.
  const listed = useMemo(() => allowed.filter(page => !session || (page.listed?.(session) ?? true)), [allowed, session])
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
  const content = match
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
              groups={navigationGroups(listed.filter(page => !page.tabOf))}
              currentId={current?.path}
              brand={<BrandLogo className="hid-ehr-blue-logo" />}
              product="Hospital EHR"
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
          {/* Help is the support assistant where this build offers it (the ehr build), and a sample elsewhere. */}
          <AccountSamplePanel panel={samplePanel === 'help' && supportChatOffered() ? null : samplePanel} onClose={() => setSamplePanel(null)} />
          <SupportChatDrawer open={samplePanel === 'help' && supportChatOffered()} onClose={() => setSamplePanel(null)} />
        </EhrAppShell>
      </AttentionProvider>
    </OpenPagesProvider></BluePagesProvider>
  )
}
