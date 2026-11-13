import { useCallback } from 'react'
import { BellRing, RotateCcw } from 'lucide-react'
import { PageState } from '../../../../kasuwa/parts'
import { Alert, Badge, Button } from '../../../../kasuwa/ui'
import { useDeptAccess } from '../../parts/access'
import { outreachCampaignApi, NOT_OFFERED } from '../campaignApi'
import {
  canSeeSensitive, focusLabel, roleLabel, stationLabel, STATIONS, type CampaignAlert, type CampaignDashboard as Dashboard,
} from '../campaignTypes'
import {
  BarRow, dayText, hourText, InsightCard, kitTestLabel, rolesWords, SENSITIVE_FOCUSES, Tile, useCampaignRead, useLiveRefresh, withinDays,
} from './insightParts'

const DASHBOARD_FAILED = 'The campaign’s counts could not be read. Try again.'

/** Kits with fewer than this share left are "running low". */
const LOW_SHARE = 0.25
/** Kits that expire within this many days are "expiring soon". */
const EXPIRING_DAYS = 30

/**
 * A campaign's dashboard: its counts as Outreach works them out, read again every 30 seconds while the page is shown
 * (and when it is shown again). Counts only, never a person; positives for HIV and hepatitis B only to those who may
 * see sensitive results (`roles`, the viewer's roles in the campaign; when not given, read from the team).
 */
export function CampaignDashboard({ campaignId, roles }: { readonly campaignId: string; readonly roles?: readonly string[] }) {
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
  if (read.state === 'not_offered') return <p className="m-0 text-[14px] text-ink-2">{NOT_OFFERED}</p>
  const value = read.value
  return (
    <div className="flex flex-col gap-4">
      {read.state === 'error' && value ? <Alert intent="error" title="Couldn’t refresh the counts">{read.error}</Alert> : null}
      <PageState loading={read.state === 'loading'} error={read.state === 'error' && !value ? read.error : null} hasData={value !== null}
        onRetry={() => void refresh()} what="the counts" rows={4}>
        {value ? <DashboardBody value={value} sensitive={sensitive} busy={busy} onRefresh={() => void refresh()} /> : null}
      </PageState>
    </div>
  )
}

function DashboardBody({ value, sensitive, busy, onRefresh }: {
  readonly value: Dashboard
  readonly sensitive: boolean
  readonly busy: boolean
  readonly onRefresh: () => void
}) {
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[13px] text-ink-3" aria-live="off">Updated {hourText(value.asOf)} · reads again every 30 seconds</p>
        <Button size="sm" icon={RotateCcw} loading={busy} onClick={() => { if (!busy) onRefresh() }}>Refresh</Button>
      </div>

      <dl aria-label="Today’s counts" className="m-0 grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-5">
        <Tile label="Registered" value={value.registered} hint={value.target > 0 ? `Target ${value.target}` : undefined} />
        <Tile label="Screened" value={value.screened} hint={value.registered > 0 ? `${Math.round((value.screened / value.registered) * 100)}% of registered` : undefined} />
        <Tile label="Waiting" value={waiting} hint={busiest && busiest.count > 0 ? `Most at ${stationLabel(busiest.station).toLowerCase()}: ${busiest.count}` : 'No one waiting'} />
        <Tile label="Positive" value={positives} hint={hiddenPositives ? `Not counting ${[...value.byFocus].filter(row => !shownFocus(row.focus)).map(row => focusLabel(row.focus).toLowerCase()).join(' or ')}` : undefined} />
        <Tile label="Referred" value={referred} tone={value.outcomes.referUrgent > 0 ? 'danger' : 'neutral'}
          hint={value.outcomes.referUrgent > 0 ? <strong className="font-semibold text-danger-ink">{value.outcomes.referUrgent} urgent</strong> : 'None urgent'} />
      </dl>

      {value.alerts.length ? <Alerts alerts={value.alerts} /> : null}

      <div className="grid gap-4 @3xl:grid-cols-2">
        {waitingRows.length ? (
          <InsightCard title="Waiting at each station" id="outreach-dash-waiting">
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {waitingRows.map(row => <BarRow key={row.station} label={stationLabel(row.station)} value={row.count}
                max={Math.max(...waitingRows.map(item => item.count), 1)} valueText={`${row.count} waiting`} tone={row.count >= 10 ? 'warn' : 'brand'} />)}
            </ul>
          </InsightCard>
        ) : null}

        <InsightCard title="By focus" id="outreach-dash-focus">
          {value.byFocus.length ? (
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {value.byFocus.map(row => (
                <li key={row.focus} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                  <span className="font-semibold text-ink">{focusLabel(row.focus)}</span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-ink-2 tabular">
                    <span>{row.screened} screened</span>
                    <span>{shownFocus(row.focus) ? `${row.positive} positive` : 'Positives: counsellors and clinicians only'}</span>
                    <span>{shownFocus(row.focus) ? `${row.referred} referred` : null}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[14px] text-ink-2">No focus is set in the plan yet.</p>}
        </InsightCard>

        <TeamCounts value={value} />
        <SitesAndHours value={value} />
        <Kits value={value} />
      </div>
    </>
  )
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
    <InsightCard title="Team" id="outreach-dash-team">
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
    </InsightCard>
  )
}

function SitesAndHours({ value }: { readonly value: Dashboard }) {
  const sites = value.bySite
  const max = Math.max(1, ...value.byHour.map(row => row.registered))
  return (
    <InsightCard title="Sites and hours" id="outreach-dash-sites">
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
    </InsightCard>
  )
}

function Kits({ value }: { readonly value: Dashboard }) {
  if (!value.kits.length) return null
  const siteName = (siteId: string) => value.bySite.find(site => site.siteId === siteId)?.name ?? 'Site'
  return (
    <InsightCard title="Kits" id="outreach-dash-kits">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
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
    </InsightCard>
  )
}

