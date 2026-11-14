import type { ReactNode } from 'react'
import { ArrowRight, Megaphone, Play, Plus } from 'lucide-react'
import { LoadingRows, PageState } from '../../../../kasuwa/parts'
import { Button } from '../../../../kasuwa/ui'
import type { OutreachCampaign } from '../../../../staff/api'
import '../../departments.css'
import { focusLabel, type OrganisationSummary } from '../campaignTypes'
import { CampaignCards } from './CampaignCards'
import type { CampaignSummary } from './campaignSummary'
import { BarRow, CountTable, NumberCard, NumberCards } from './insightParts'
import { MoreMenu, type MoreItem } from './MoreMenu'
import { isRunning, type OrganisationNumbers } from './organisationSummary'

/** The Overview shows this many campaigns running now; every campaign is in Campaigns. */
export const HOME_CAMPAIGNS = 3

/** Running first, then planned, then closed; newest first within each. */
export function campaignOrder(campaigns: readonly OutreachCampaign[], now = Date.now()): OutreachCampaign[] {
  const rank = (campaign: OutreachCampaign) => isRunning(campaign, now) ? 0 : campaign.status === 'active' ? 1 : campaign.status === 'planned' ? 2 : 3
  return [...campaigns].sort((a, b) => rank(a) - rank(b) || Date.parse(b.startsAt) - Date.parse(a.startsAt))
}

const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%')

/** A long campaign name cut to fit one button line on a phone; the full name is the button's accessible name. */
export function shortName(name: string): string {
  return name.length > 22 ? `${name.slice(0, 21).trimEnd()}…` : name
}

/**
 * Overview: Outreach's home for the organisation's owner, admins and coordinators (owner, 13 November 2026): the numbers
 * first (people reached, outreaches run, screened, positive, referred), then each type of outreach and the conditions
 * found, then the one thing to do next (carry on with the campaign running, or start one), then at most three campaigns
 * running now and All campaigns (Campaigns, a page of its own). Team and the registrations made before campaigns are in
 * the menu (⋯).
 */
export function OrganisationHome({ organisationName, numbers, campaigns, campaignsRead, summaryOf, registeredIn, continuing, onContinue,
  onNewCampaign, onOpenCampaign, onAllCampaigns, menu, top }: {
  readonly organisationName: string | undefined
  readonly numbers: OrganisationNumbers
  readonly campaigns: readonly OutreachCampaign[]
  readonly campaignsRead: { readonly loading: boolean; readonly error: string; readonly listed: boolean; readonly retry: () => void }
  readonly summaryOf: (campaignId: string) => CampaignSummary | undefined
  readonly registeredIn: (campaignId: string) => number | undefined
  readonly continuing: OutreachCampaign | undefined
  readonly onContinue: (campaign: OutreachCampaign) => void
  readonly onNewCampaign?: () => void
  readonly onOpenCampaign: (campaign: OutreachCampaign) => void
  readonly onAllCampaigns: () => void
  readonly menu: readonly MoreItem[]
  /** Lasting state above the numbers: an outreach group's standing, what waits on this device. */
  readonly top?: ReactNode
}) {
  const running = campaignOrder(campaigns).filter(campaign => isRunning(campaign))
  const shown = running.slice(0, HOME_CAMPAIGNS)
  const value = numbers.state === 'ready' ? numbers.value : null
  return (
    <div className="hid-ehr-dept">
      {/* The title and More (⋯) on one row, the organisation under them: never ⋯ on a row of its own. */}
      <header className="mb-5 flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="hid-ehr-page-title m-0 min-w-0 flex-1 break-words">Overview</h1>
          {menu.length ? <MoreMenu id="outreach-home-more" items={menu} className="shrink-0" /> : null}
        </div>
        {organisationName ? <p className="m-0 text-[13px] break-words text-ink-2">{organisationName}</p> : null}
      </header>
      <div className="flex flex-col gap-6">
        {top}
        {numbers.state === 'loading' ? <LoadingRows rows={2} label="Loading the numbers" /> : value ? <Numbers value={value} onAllCampaigns={onAllCampaigns} /> : null}

        {campaigns.length ? <Actions continuing={continuing} onContinue={onContinue} onNewCampaign={onNewCampaign} /> : null}

        <section aria-labelledby="outreach-running-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h2 id="outreach-running-heading" className="m-0 text-title-2 text-ink">Running now</h2>
            {campaigns.length ? (
              <Button variant="ghost" iconRight={ArrowRight} id="outreach-all-campaigns"
                onClick={onAllCampaigns}>All campaigns ({campaigns.length})</Button>
            ) : null}
          </div>
          <PageState loading={campaignsRead.loading} error={campaignsRead.listed ? null : campaignsRead.error || null} hasData={campaignsRead.listed}
            onRetry={campaignsRead.retry} what="campaigns" rows={2}
            empty={campaignsRead.listed && campaigns.length === 0 ? onNewCampaign
              ? { icon: Megaphone, title: 'Create your first campaign', description: 'A campaign is one outreach event or drive: what it screens for, '
                + 'where, and who helps. You become its coordinator, and everyone you register gets their own Health ID record.',
              action: <Button variant="primary" size="lg" icon={Plus} onClick={onNewCampaign}>Create your first campaign</Button> }
              : { icon: Megaphone, title: 'No campaigns yet', description: 'Campaigns your organisation runs show here.' } : null}>
            {shown.length ? <CampaignCards label="Running now" campaigns={shown} summaryOf={summaryOf} registeredIn={registeredIn} onOpen={onOpenCampaign} />
              : <p className="m-0 text-[14px] text-ink-2">No campaign is running now.</p>}
          </PageState>
        </section>
      </div>
    </div>
  )
}

/** The one main action (carry on with the campaign running), and New campaign beside it. */
function Actions({ continuing, onContinue, onNewCampaign }: {
  readonly continuing: OutreachCampaign | undefined
  readonly onContinue: (campaign: OutreachCampaign) => void
  readonly onNewCampaign?: () => void
}) {
  if (!continuing && !onNewCampaign) return null
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
      {continuing && onNewCampaign ? <Button id="outreach-new-campaign" size="lg" icon={Plus} onClick={onNewCampaign}>New campaign</Button> : null}
      {continuing ? (
        <Button id="outreach-continue" variant="primary" size="lg" icon={Play} className="max-w-full" aria-label={`Continue ${continuing.name}`}
          onClick={() => onContinue(continuing)}><span className="truncate">Continue {shortName(continuing.name)}</span></Button>
      ) : <Button id="outreach-new-campaign" variant="primary" size="lg" icon={Plus} onClick={onNewCampaign}>New campaign</Button>}
    </div>
  )
}

/** The organisation's numbers: the stat cards, then each type of outreach (a table), and the conditions found. */
function Numbers({ value, onAllCampaigns }: { readonly value: OrganisationSummary; readonly onAllCampaigns: () => void }) {
  return (
    <>
      <NumberCards label="Your outreach in numbers">
        <NumberCard label="People reached" value={value.people.reached}
          lead={value.people.thisMonth > 0 ? { text: `+${value.people.thisMonth}`, tone: 'up' } : undefined}
          hint={value.people.thisMonth >= 0 ? 'this month' : 'in every campaign'} />
        <NumberCard label="Outreaches run" value={value.campaigns.total} onOpen={onAllCampaigns} openLabel="See all campaigns"
          hint={value.campaigns.running ? `${value.campaigns.running} running` : value.campaigns.planned ? `${value.campaigns.planned} planned` : 'none running'} />
        <NumberCard label="Screened" value={value.screened}
          hint={value.people.reached > 0 ? `${share(value.screened, value.people.reached)} of people reached` : 'no one yet'} />
        <NumberCard label="Positive" value={value.positive}
          hint={value.screened > 0 ? `${share(value.positive, value.screened)} of screened` : 'no one screened yet'} />
        <NumberCard label="Referred" value={value.referred} hint="to a clinic or hospital" />
      </NumberCards>

      {value.byFocus.length ? (
        <section aria-labelledby="outreach-types-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="outreach-types-heading" className="m-0 text-title-2 text-ink">By type of outreach</h2>
          <CountTable label="By type of outreach"
            columns={[{ head: 'Type of outreach' }, { head: 'Campaigns', wide: true }, { head: 'Screened' }, { head: 'Positive' }, { head: 'Referred' }]}
            rows={value.byFocus.map(row => ({ key: row.focus, name: focusLabel(row.focus, row.label), cells: [row.campaigns, row.screened, row.positive, row.referred] }))} />
        </section>
      ) : null}

      {value.conditions.length ? (
        <section aria-labelledby="outreach-conditions-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="outreach-conditions-heading" className="m-0 text-title-2 text-ink">Conditions found</h2>
          <div className="rounded-xl bg-surface p-4 ring-1 ring-line sm:p-5">
            <ul aria-label="Conditions found: positive of those screened" className="m-0 flex list-none flex-col gap-3 p-0">
              {value.conditions.map(row => (
                <BarRow key={row.condition} label={focusLabel(row.condition, row.label)} value={row.positive} max={Math.max(row.screened, 1)}
                  valueText={`${row.positive} of ${row.screened} positive (${share(row.positive, row.screened)})`} tone={row.positive > 0 ? 'warn' : 'muted'} />
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </>
  )
}
