import { useState } from 'react'
import { ArrowRight, MapPin } from 'lucide-react'
import { FormActions, LoadingRows, PageState } from '../../../../kasuwa/parts'
import { Button, EmptyState } from '../../../../kasuwa/ui'
import { useFocusById } from '../../../../staff/focus'
import { NOT_OFFERED } from '../campaignApi'
import { STATIONS, type OutreachPlan, type StationKind } from '../campaignTypes'
import { DayScope, useCampaignDay, type Read } from './dayContext'
import { BigChoice, dayFromToday, SyncStatus } from './dayParts'

/**
 * "Where are you today?": the site and the station as big tap targets (only the stations in the plan; a one-person
 * campaign has none to pick), the kit lot for each test kit at a testing station, remembered on this device for the day
 * (useDaySettings), and what waits to be sent. Start saves them and hands over to the station.
 */
export function DayStart({ campaignId, onStart }: { readonly campaignId: string; readonly onStart: () => void }) {
  return <DayScope campaignId={campaignId}><DayStartBody onStart={onStart} /></DayScope>
}

const SITE_ID = 'outreach-day-site'
const STATION_ID = 'outreach-day-station'

function DayStartBody({ onStart }: { readonly onStart: () => void }) {
  const day = useCampaignDay()
  return (
    <section aria-labelledby="outreach-day-heading" className="flex flex-col gap-5">
      <h2 id="outreach-day-heading" tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">Where are you today?</h2>
      <SyncStatus />
      <PlanState plan={day.plan} onRetry={day.refreshPlan}>{plan => <DayChoices plan={plan} onStart={onStart} />}</PlanState>
    </section>
  )
}

/** The plan's states, said once for every field-day screen. */
export function PlanState({ plan, onRetry, children }: {
  readonly plan: Read<OutreachPlan>
  readonly onRetry: () => void
  readonly children: (plan: OutreachPlan) => React.ReactNode
}) {
  if (plan.status === 'loading') return <LoadingRows rows={3} label="Loading the campaign plan" />
  if (plan.status === 'error') return <PageState loading={false} error={plan.message} hasData={false} onRetry={onRetry} what="the campaign plan">{null}</PageState>
  if (plan.status === 'none') {
    return <EmptyState compact icon={MapPin} title={plan.reason === 'no_plan' ? 'No plan yet' : 'Not available yet'}
      description={plan.reason === 'no_plan' ? 'A coordinator sets the sites, stations and tests first, in Setup.' : NOT_OFFERED} />
  }
  return <>{children(plan.value)}</>
}

function DayChoices({ plan, onStart }: { readonly plan: OutreachPlan; readonly onStart: () => void }) {
  const { settings, saveSettings } = useCampaignDay()
  const focus = useFocusById()
  const onePerson = plan.stationMode === 'one_person'
  const [site, setSite] = useState<string | null>(null)
  const [station, setStation] = useState<StationKind | null>(null)
  const [lots, setLots] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<'site' | 'station' | null>(null)
  const [busy, setBusy] = useState(false)

  // What this device remembered, until the person picks again; a single site is picked for them.
  const siteId = site ?? (plan.sites.some(item => item.id === settings?.siteId) ? settings!.siteId : plan.sites.length === 1 ? plan.sites[0]!.id : null)
  const stations = STATIONS.filter(item => plan.stations.includes(item.value))
  const stationKind = onePerson ? null : station ?? (stations.some(item => item.value === settings?.station) ? settings!.station : stations.length === 1 ? stations[0]!.value : null)
  const today = dayFromToday(0)
  const kitTests = onePerson || stationKind === 'tests' ? plan.package.tests.filter(test => test.usesKit) : []
  const lotsFor = (testId: string) => plan.kits.filter(kit => kit.testId === testId && kit.siteId === siteId && kit.expiresOn >= today)
  const lotOf = (testId: string) => {
    const available = lotsFor(testId)
    const picked = lots[testId] ?? settings?.kitLots[testId]
    if (picked && available.some(kit => kit.lot === picked)) return picked
    return available.length === 1 ? available[0]!.lot : null
  }

  async function start() {
    if (busy) return
    if (!siteId) { setProblem('site'); focus(SITE_ID); return }
    if (!onePerson && !stationKind) { setProblem('station'); focus(STATION_ID); return }
    setProblem(null)
    setBusy(true)
    try {
      const kitLots = Object.fromEntries(kitTests.map(test => [test.id, lotOf(test.id)]).filter((entry): entry is [string, string] => entry[1] !== null))
      await saveSettings({ siteId, station: stationKind, kitLots })
    } catch {
      // Not remembered on this device: the day still starts, and the choice is asked again next time.
    } finally {
      setBusy(false)
    }
    onStart()
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-title-3 text-ink">Site</legend>
        {problem === 'site' ? <p id={`${SITE_ID}-error`} role="alert" className="m-0 text-[14px] font-medium text-danger-ink">Choose where you are.</p> : null}
        <BigChoice label="Site" id={SITE_ID} value={siteId} invalid={problem === 'site'} describedBy={problem === 'site' ? `${SITE_ID}-error` : undefined}
          onChange={value => { setSite(value); setProblem(null) }} columns={plan.sites.length > 1 ? 2 : 1}
          options={plan.sites.map(item => ({ value: item.id, label: item.name, hint: item.community || item.address }))} />
      </fieldset>
      {onePerson ? (
        <p className="m-0 text-[15px] text-ink-2">You do everything for each person: register, vital signs, tests and the outcome, on this phone.</p>
      ) : (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-title-3 text-ink">Your station</legend>
          {problem === 'station' ? <p id={`${STATION_ID}-error`} role="alert" className="m-0 text-[14px] font-medium text-danger-ink">Choose your station.</p> : null}
          <BigChoice label="Your station" id={STATION_ID} value={stationKind} invalid={problem === 'station'} describedBy={problem === 'station' ? `${STATION_ID}-error` : undefined}
            onChange={value => { setStation(value); setProblem(null) }} columns="wide"
            options={stations.map(item => ({ value: item.value, label: item.label, hint: item.hint }))} />
        </fieldset>
      )}
      {kitTests.length && siteId ? (
        <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
          <legend className="mb-2 text-title-3 text-ink">Kit lot in use</legend>
          {kitTests.map(test => {
            const available = lotsFor(test.id)
            return (
              <div key={test.id} className="flex flex-col gap-2">
                <p className="m-0 text-[15px] font-medium text-ink">{test.name}</p>
                {available.length ? (
                  <BigChoice label={`Kit lot for ${test.name}`} value={lotOf(test.id)} size="md" onChange={lot => setLots(previous => ({ ...previous, [test.id]: lot }))}
                    options={available.map(kit => ({ value: kit.lot, label: `Lot ${kit.lot}`, hint: `Use by ${kit.expiresOn}` }))} />
                ) : <p className="m-0 text-[14px] text-ink-2">No unexpired kits for this test at this site. Ask the coordinator.</p>}
              </div>
            )
          })}
        </fieldset>
      ) : null}
      <FormActions>
        <Button variant="primary" size="lg" className="h-14" iconRight={ArrowRight} aria-disabled={busy || undefined} onClick={() => void start()}>
          {onePerson ? 'Start seeing people' : 'Start at this station'}
        </Button>
      </FormActions>
    </div>
  )
}
