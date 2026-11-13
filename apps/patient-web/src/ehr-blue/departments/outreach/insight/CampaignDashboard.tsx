import { useCallback, type ReactNode } from 'react'
import { BellRing, Clock, Send, Stethoscope, TestTube, Users } from 'lucide-react'
import { PageState } from '../../../../kasuwa/parts'
import { Badge, cx, StatGroup } from '../../../../kasuwa/ui'
import { useDeptAccess } from '../../parts/access'
import { outreachCampaignApi, NOT_OFFERED } from '../campaignApi'
import {
  canSeeSensitive, focusLabel, roleLabel, stationLabel, STATIONS, type CampaignAlert, type CampaignDashboard as Dashboard,
} from '../campaignTypes'
import {
  BarRow, dayText, hourText, InsightCard, kitTestLabel, NumberTile, NumberTiles, rolesWords, SectionSwitch, SENSITIVE_FOCUSES, StatTile, useCampaignRead, useLiveRefresh, withinDays,
} from './insightParts'
import { useErrorToast } from '../notify'

const DASHBOARD_FAILED = 'The campaign’s counts could not be read. Try again.'

/** Kits with fewer than this share left are "running low". */
const LOW_SHARE = 0.25
/** Kits that expire within this many days are "expiring soon". */
const EXPIRING_DAYS = 30

/**
 * A campaign's Overview (its numbers; never called a dashboard on screen): its counts as Outreach works them out, read again every 30 seconds while the page is shown
 * (and when it is shown again). Counts only, never a person; positives for HIV and hepatitis B only to those who may
 * see sensitive results (`roles`, the viewer's roles in the campaign; when not given, read from the team).
 */
/** Where an Overview tile leads: a campaign tab, with People shown for those who need care. */
export type DashboardOpen = (tab: 'people' | 'followups' | 'today', filter?: 'care') => void

export function CampaignDashboard({ campaignId, roles, onOpen, opens = [] }: {
  readonly campaignId: string
  readonly roles?: readonly string[]
  /** Opens what a tile counts (none: the tiles open nothing). */
  readonly onOpen?: DashboardOpen
  /** The tabs the viewer has: a tile opens only one of these. */
  readonly opens?: readonly string[]
}) {
  const { facilityId } = useDeptAccess()
  const enabled = Boolean(facilityId)
  const dashboard = useCampaignRead(enabled,
    useCallback((signal: AbortSignal) => outreachCampaignApi.dashboard(facilityId!, campaignId, signal), [facilityId, campaignId]), DASHBOARD_FAILED)
  const team = useCampaignRead(enabled && !roles,
    useCallback((signal: AbortSignal) => outreachCampaignApi.team(facilityId!, campaignId, signal), [facilityId, campaignId]), DASHBOARD_FAILED)
  const viewerRoles = roles ?? (team.read.state === 'ready' ? team.read.value.you?.roles ?? [] : [])
  const sensitive = canSeeSensitive(viewerRoles)
  const { refresh, busy } = dashboard
  useLiveRefresh(useCallback(() => { if (!busy) void refresh() }, [busy, refresh]), 30_000, enabled && dashboard.read.state !== 'not_offered')

  const { read } = dashboard
  useErrorToast(read.state === 'error' && read.value ? read.error : null, 'Couldn’t refresh the counts', () => void refresh())
  if (read.state === 'not_offered') return <p className="m-0 text-[14px] text-ink-2">{NOT_OFFERED}</p>
  const value = read.value
  return (
    <div className="flex flex-col gap-4">
      <PageState loading={read.state === 'loading'} error={read.state === 'error' && !value ? read.error : null} hasData={value !== null}
        onRetry={() => void refresh()} what="the counts" rows={4}>
        {value ? <DashboardBody value={value} sensitive={sensitive}
          onOpen={onOpen ? (tab, filter) => { if (opens.includes(tab)) onOpen(tab, filter) } : undefined} opens={onOpen ? opens : []} /> : null}
      </PageState>
    </div>
  )
}

function DashboardBody({ value, sensitive, onOpen, opens }: {
  readonly value: Dashboard
  readonly sensitive: boolean
  readonly onOpen?: DashboardOpen
  readonly opens: readonly string[]
}) {
  const opener = (tab: Parameters<DashboardOpen>[0], filter?: 'care') => onOpen && opens.includes(tab) ? () => onOpen(tab, filter) : undefined
  const shownFocus = (focus: Dashboard['byFocus'][number]['focus']) => sensitive || !SENSITIVE_FOCUSES.has(focus)
  const positives = value.byFocus.filter(row => shownFocus(row.focus)).reduce((sum, row) => sum + row.positive, 0)
  const hiddenPositives = value.byFocus.some(row => !shownFocus(row.focus))
  const referred = value.outcomes.referUrgent + value.outcomes.referRoutine
  const waitingRows = STATIONS.filter(station => station.value !== 'register' && value.waiting[station.value] !== undefined)
    .map(station => ({ station: station.value, count: value.waiting[station.value] ?? 0 }))
  const waiting = waitingRows.reduce((sum, row) => sum + row.count, 0)
  const busiest = [...waitingRows].sort((a, b) => b.count - a.count)[0]

  return (
    <>
      {/* Read again every 30 seconds and when the page is shown again: no Refresh button, only when it was last read. */}
      <p className="m-0 text-[13px] text-ink-3" aria-live="off">Updated {hourText(value.asOf)}</p>

      <NumberTiles label="Today’s counts">
        <NumberTile hero icon={Users} tone="brand" label="Registered" value={value.registered} hint={value.target > 0 ? `Target ${value.target}` : 'No target set'}
          onOpen={opener('people')} />
        <NumberTile icon={Stethoscope} tone="info" label="Screened" value={value.screened}
          hint={value.registered > 0 ? `${Math.round((value.screened / value.registered) * 100)}% of registered` : 'No one registered yet'} />
        <NumberTile icon={Clock} tone={waiting > 0 ? 'warn' : 'neutral'} label="Waiting" value={waiting}
          hint={busiest && busiest.count > 0 ? `Most at ${stationLabel(busiest.station).toLowerCase()}: ${busiest.count}` : 'No one waiting'} />
        <NumberTile icon={TestTube} tone="violet" label="Positive" value={positives}
          hint={hiddenPositives ? `Not counting ${[...value.byFocus].filter(row => !shownFocus(row.focus)).map(row => focusLabel(row.focus, row.label).toLowerCase()).join(' or ')}` : 'Across every focus'}
          onOpen={opener('people', 'care')} />
        <NumberTile icon={Send} tone={value.outcomes.referUrgent > 0 ? 'danger' : 'neutral'} label="Referred" value={referred}
          hint={value.outcomes.referUrgent > 0 ? <strong className="font-semibold text-danger-ink">{value.outcomes.referUrgent} urgent</strong> : 'None urgent'}
          onOpen={opener('followups')} />
      </NumberTiles>

      {value.alerts.length ? <Alerts alerts={value.alerts} /> : null}

      {/* The detail one part at a time, so the dashboard fits a screen. */}
      <SectionSwitch id="outreach-dash-detail" label="Overview detail" sections={[
        { value: 'stations', label: 'Stations', content: <Panel>{waitingRows.length ? (
          <ul aria-label="Waiting at each station" className="m-0 flex list-none flex-col gap-3 p-0">
            {waitingRows.map(row => <BarRow key={row.station} label={stationLabel(row.station)} value={row.count}
              max={Math.max(...waitingRows.map(item => item.count), 1)} valueText={`${row.count} waiting`} tone={row.count >= 10 ? 'warn' : 'brand'} />)}
          </ul>
        ) : <p className="m-0 text-[14px] text-ink-2">Everyone is registered at one station: no one waits between stations.</p>}</Panel> },
        { value: 'focus', label: 'Focus', content: <Panel>{value.byFocus.length ? (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {value.byFocus.map(row => {
              const name = focusLabel(row.focus, row.label)
              return (
                <li key={row.focus} className="flex flex-col gap-2">
                  <h3 className="m-0 text-[15px] font-semibold text-ink">{name}</h3>
                  {shownFocus(row.focus) ? (
                    <StatGroup label={name} cols={3} className="!grid-cols-3">
                      <StatTile label="Screened" value={row.screened} />
                      <StatTile label="Positive" value={row.positive} />
                      <StatTile label="Referred" value={row.referred} />
                    </StatGroup>
                  ) : (
                    <>
                      <StatGroup label={name} cols={3} className="!grid-cols-3"><StatTile label="Screened" value={row.screened} /></StatGroup>
                      <p className="m-0 text-[13px] text-ink-3">Positives: counsellors and clinicians only</p>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        ) : <p className="m-0 text-[14px] text-ink-2">No focus is set in the plan yet.</p>}</Panel> },
        { value: 'team', label: 'Team', content: <Panel><TeamCounts value={value} /></Panel> },
        { value: 'sites', label: 'Sites', content: <Panel><SitesAndHours value={value} /></Panel> },
        ...(value.kits.length ? [{ value: 'kits' as const, label: 'Kits', content: <Panel><Kits value={value} /></Panel> }] : []),
      ]} />
    </>
  )
}

/** A switched part's card: the tab above names it, so it has no heading of its own. */
function Panel({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={cx('flex min-w-0 flex-col gap-3 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-5', className)}>{children}</div>
}

const ALERT_TONE: Readonly<Record<CampaignAlert['kind'], 'danger' | 'warn'>> = {
  urgent_referral: 'danger', kit_low: 'warn', kit_expiring: 'warn', invalid_tests: 'warn', queue_long: 'warn', follow_up_overdue: 'warn',
}
const ALERT_WORD: Readonly<Record<CampaignAlert['kind'], string>> = {
  urgent_referral: 'Urgent', kit_low: 'Kits', kit_expiring: 'Kits', invalid_tests: 'Tests', queue_long: 'Waiting', follow_up_overdue: 'Follow-up',
}

function Alerts({ alerts }: { readonly alerts: readonly CampaignAlert[] }) {
  // The urgent ones first.
  const sorted = [...alerts].sort((a, b) => Number(ALERT_TONE[b.kind] === 'danger') - Number(ALERT_TONE[a.kind] === 'danger'))
  return (
    <InsightCard title="Needs attention" id="outreach-dash-alerts" action={<BellRing className="size-4 text-ink-3" aria-hidden />}>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {sorted.map((alert, index) => (
          <li key={`${alert.kind}-${index}`} className="flex flex-wrap items-start gap-2 text-[14px] text-ink">
            <Badge size="sm" tone={ALERT_TONE[alert.kind]}>{ALERT_WORD[alert.kind]}</Badge>
            <span className="min-w-0 flex-1 break-words">{alert.message}</span>
          </li>
        ))}
      </ul>
    </InsightCard>
  )
}

function TeamCounts({ value }: { readonly value: Dashboard }) {
  const rows = [...value.byMember].sort((a, b) => (b.registered + b.screened) - (a.registered + a.screened) || (a.name ?? '').localeCompare(b.name ?? ''))
  const max = Math.max(1, ...rows.map(row => Math.max(row.registered, row.screened)))
  return (
    <>
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {rows.map(row => (
            <li key={row.memberId} className="flex flex-col gap-2">
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-semibold text-ink">{row.name ?? 'Team member'}</span>
                <span className="text-[13px] text-ink-3">{rolesWords(row.roles, roleLabel)}</span>
              </span>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                <BarRow label="Registered" value={row.registered} max={max} />
                <BarRow label="Screened" value={row.screened} max={max} tone="muted" />
              </ul>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-[14px] text-ink-2">No one has recorded anything yet.</p>}
    </>
  )
}

function SitesAndHours({ value }: { readonly value: Dashboard }) {
  const sites = value.bySite
  const max = Math.max(1, ...value.byHour.map(row => row.registered))
  return (
    <>
      {sites.length ? (
        <div className="flex flex-col gap-5">
          {sites.map(site => {
            const hours = value.byHour.filter(row => row.siteId === site.siteId)
            return (
              <div key={site.siteId} className="flex flex-col gap-2">
                <h3 className="m-0 text-[15px] font-semibold text-ink">{site.name}</h3>
                <p className="m-0 text-[13px] text-ink-2 tabular">{site.registered} registered · {site.screened} screened</p>
                {hours.length ? (
                  <ul aria-label={`People registered each hour at ${site.name}`} className="m-0 flex list-none flex-col gap-2 p-0">
                    {hours.map(row => <BarRow key={row.hour} label={`${dayText(row.hour)}, ${hourText(row.hour)}`} value={row.registered} max={max}
                      valueText={`${row.registered} ${row.registered === 1 ? 'person' : 'people'}`} />)}
                  </ul>
                ) : <p className="m-0 text-[13px] text-ink-3">No one registered here yet.</p>}
              </div>
            )
          })}
        </div>
      ) : <p className="m-0 text-[14px] text-ink-2">No sites in the plan yet.</p>}
    </>
  )
}

function Kits({ value }: { readonly value: Dashboard }) {
  if (!value.kits.length) return null
  const siteName = (siteId: string) => value.bySite.find(site => site.siteId === siteId)?.name ?? 'Site'
  return (
    <ul aria-label="Kits" className="m-0 flex list-none flex-col gap-3 p-0">
        {value.kits.map(kit => {
          const low = kit.count > 0 && kit.left < kit.count * LOW_SHARE
          const expiring = withinDays(kit.expiresOn, EXPIRING_DAYS)
          return (
            <BarRow key={kit.kitId} label={<>{kitTestLabel(kit.testId)} · lot {kit.lot} · {siteName(kit.siteId)}</>}
              value={kit.left} max={kit.count} valueText={`${kit.left} left`} tone={low ? 'danger' : 'brand'}
              detail={<span className="inline-flex flex-wrap items-center gap-2">
                <span className="tabular">{kit.used} used of {kit.count}</span>
                {low ? <Badge size="sm" tone="danger">Running low</Badge> : null}
                {expiring ? <Badge size="sm" tone="warn">Expires {dayText(kit.expiresOn, true)}</Badge> : <span>Expires {dayText(kit.expiresOn, true)}</span>}
              </span>} />
          )
        })}
    </ul>
  )
}

