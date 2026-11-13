import type { ReactNode } from 'react'
import { ArrowRight, Megaphone, Play, Plus, Send, Stethoscope, TestTube, Users } from 'lucide-react'
import { LoadingRows, PageState } from '../../../../kasuwa/parts'
import { Button, StatGroup } from '../../../../kasuwa/ui'
import type { OutreachCampaign } from '../../../../staff/api'
import { DeptPage } from '../../parts/DeptPage'
import { focusLabel, type OrganisationSummary } from '../campaignTypes'
import { CampaignCards } from './CampaignCards'
import type { CampaignSummary } from './campaignSummary'
import { BarRow, StatTile } from './insightParts'
import { MoreMenu, type MoreItem } from './MoreMenu'
import { isRunning, type OrganisationNumbers } from './organisationSummary'

/** The home shows this many campaigns; the rest are in All campaigns. */
export const HOME_CAMPAIGNS = 6

/** Running first, then planned, then closed; newest first within each. */
export function campaignOrder(campaigns: readonly OutreachCampaign[], now = Date.now()): OutreachCampaign[] {
  const rank = (campaign: OutreachCampaign) => isRunning(campaign, now) ? 0 : campaign.status === 'active' ? 1 : campaign.status === 'planned' ? 2 : 3
  return [...campaigns].sort((a, b) => rank(a) - rank(b) || Date.parse(b.startsAt) - Date.parse(a.startsAt))
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%')

/** A long campaign name cut to fit one button line on a phone; the full name is the button's accessible name. */
export function shortName(name: string): string {
  return name.length > 22 ? `${name.slice(0, 21).trimEnd()}…` : name
}

/**
 * Outreach's home for the organisation's owner, admins and coordinators (owner, 13 November 2026): the numbers first
 * (outreaches run, people reached, screened, positive, referred), then each type of outreach and the conditions found,
 * then the one thing to do next (carry on with the campaign running, or start one), then the campaigns (at most six;
 * the rest in All campaigns). Team and the registrations made before campaigns are in the menu (⋯).
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
  const ordered = campaignOrder(campaigns)
  const shown = ordered.slice(0, HOME_CAMPAIGNS)
  const value = numbers.state === 'ready' ? numbers.value : null
  return (
    <DeptPage title="Outreach" description={organisationName} secondaryActions={menu.length ? <MoreMenu id="outreach-home-more" items={menu} /> : undefined}>
      <div className="flex flex-col gap-6">
        {top}
        {numbers.state === 'loading' ? <LoadingRows rows={2} label="Loading the numbers" /> : value ? <Numbers value={value} /> : null}

        {campaigns.length ? <Actions continuing={continuing} onContinue={onContinue} onNewCampaign={onNewCampaign} /> : null}

        <section aria-labelledby="outreach-campaigns-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="outreach-campaigns-heading" className="m-0 text-title-2 text-ink">Campaigns</h2>
            {ordered.length > HOME_CAMPAIGNS ? (
              <Button variant="ghost" iconRight={ArrowRight} id="outreach-all-campaigns" onClick={onAllCampaigns}>All campaigns ({ordered.length})</Button>
            ) : null}
          </div>
          <PageState loading={campaignsRead.loading} error={campaignsRead.listed ? null : campaignsRead.error || null} hasData={campaignsRead.listed}
            onRetry={campaignsRead.retry} what="campaigns" rows={2}
            empty={campaignsRead.listed && campaigns.length === 0 ? onNewCampaign
              ? { icon: Megaphone, title: 'Create your first campaign', description: 'A campaign is one outreach event or drive: what it screens for, '
                + 'where, and who helps. You become its coordinator, and everyone you register gets their own Health ID record.',
              action: <Button variant="primary" size="lg" icon={Plus} onClick={onNewCampaign}>Create your first campaign</Button> }
              : { icon: Megaphone, title: 'No campaigns yet', description: 'Campaigns your organisation runs show here.' } : null}>
            <CampaignCards campaigns={shown} summaryOf={summaryOf} registeredIn={registeredIn} onOpen={onOpenCampaign} />
          </PageState>
        </section>
      </div>
    </DeptPage>
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

/** The organisation's numbers: the tiles, each type of outreach, and the conditions found. */
function Numbers({ value }: { readonly value: OrganisationSummary }) {
  return (
    <>
      <StatGroup label="Your outreach in numbers" cols={3}>
        <StatTile icon={Megaphone} tone="brand" label="Outreaches run" value={value.campaigns.total}
          hint={value.campaigns.running ? `${value.campaigns.running} running` : value.campaigns.planned ? `${value.campaigns.planned} planned` : 'None running'} />
        <StatTile icon={Users} tone="info" label="People reached" value={value.people.reached}
          hint={value.people.thisMonth >= 0 ? `This month +${value.people.thisMonth}` : 'In every campaign'} />
        <StatTile icon={Stethoscope} tone="neutral" label="Screened" value={value.screened}
          hint={value.people.reached > 0 ? `${share(value.screened, value.people.reached)} of people reached` : 'No one yet'} />
        <StatTile icon={TestTube} tone="violet" label="Positive" value={value.positive}
          hint={value.screened > 0 ? `${share(value.positive, value.screened)} of screened` : 'No one screened yet'} />
        <StatTile icon={Send} tone="warn" label="Referred" value={value.referred} hint="To a clinic or hospital" />
      </StatGroup>

      {value.byFocus.length || value.conditions.length ? (
        <div className="grid gap-6 @3xl:grid-cols-2">
          {value.byFocus.length ? (
            <section aria-labelledby="outreach-types-heading" className="flex min-w-0 flex-col gap-3">
              <h2 id="outreach-types-heading" className="m-0 text-title-2 text-ink">By type of outreach</h2>
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-2 p-0">
                {value.byFocus.map(row => {
                  const name = focusLabel(row.focus, row.label)
                  return (
                    <li key={row.focus} className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface p-3.5 shadow-[var(--shadow-card)] ring-1 ring-line">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <h3 className="m-0 text-[15px] font-semibold break-words text-ink">{name}</h3>
                        <span className="text-[13px] text-ink-3">{plural(row.campaigns, 'campaign')}</span>
                      </span>
                      <dl className="m-0 grid grid-cols-3 gap-1 text-center">
                        {([['Screened', row.screened], ['Positive', row.positive], ['Referred', row.referred]] as const).map(([what, count]) => (
                          <div key={what} className="flex flex-col-reverse rounded-lg bg-tray px-1 py-1.5">
                            <dt className="text-[12px] text-ink-2">{what}</dt>
                            <dd className="m-0 text-[17px] font-semibold text-ink tabular">{count}</dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
          {value.conditions.length ? (
            <section aria-labelledby="outreach-conditions-heading" className="flex min-w-0 flex-col gap-3">
              <h2 id="outreach-conditions-heading" className="m-0 text-title-2 text-ink">Conditions found</h2>
              <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-5">
                <ul aria-label="Conditions found: positive of those screened" className="m-0 flex list-none flex-col gap-3 p-0">
                  {value.conditions.map(row => (
                    <BarRow key={row.condition} label={focusLabel(row.condition, row.label)} value={row.positive} max={Math.max(row.screened, 1)}
                      valueText={`${row.positive} of ${row.screened} positive (${share(row.positive, row.screened)})`} tone={row.positive > 0 ? 'warn' : 'muted'} />
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
