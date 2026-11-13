import { useEffect, useState } from 'react'
import { MapPin, Settings2 } from 'lucide-react'
import { Button, Card } from '../../../../kasuwa/ui'
import { AllInOne, DayStart, RegisterPerson, StationWork } from '../day'
import { stationLabel, type OutreachPlan, type OutreachVisit } from '../campaignTypes'
import { LoadingRows } from '../../../../kasuwa/parts'
import { outreachQueueStore, readDaySettings, type DaySettings } from '../offlineQueue'

/**
 * The campaign's Today tab: start the day (site and station, remembered on this device), then the work of that station:
 * register people, a station's form found by visit code, or everything on one device when the plan has one person do it
 * all. What waits to be sent is said by the day's own screens.
 */
export function CampaignToday({ campaignId, facilityId, accountId, plan, canSetUp, onSetUp, onRegistered }: {
  readonly campaignId: string
  readonly facilityId: string
  readonly accountId: string | undefined
  /** The plan; null when none is saved yet, undefined while it is read (the day's own screens say how that stands). */
  readonly plan: OutreachPlan | null | undefined
  /** A coordinator, who can set the plan up. */
  readonly canSetUp: boolean
  readonly onSetUp: () => void
  readonly onRegistered: (visit: OutreachVisit) => void
}) {
  // DayStart keeps its choice on this device; the work below reads it again once it is made.
  const [started, setStarted] = useState(0)
  const [changing, setChanging] = useState(false)

  if (plan === null) {
    return (
      <Card className="flex flex-col items-start gap-3 p-4 sm:p-5">
        <h2 className="m-0 text-title-3 text-ink">No plan yet</h2>
        <p className="m-0 text-[15px] text-ink-2">{canSetUp
          ? 'Set out the sites, what is checked and who does it. Then the team can start.'
          : 'A coordinator sets out the sites and what is checked. You can start once they have.'}</p>
        {canSetUp ? <Button size="lg" variant="primary" icon={Settings2} onClick={onSetUp}>Set up the plan</Button> : null}
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {changing
        ? <DayStart campaignId={campaignId} onStart={() => { setChanging(false); setStarted(count => count + 1) }} />
        : <TodayWork key={started} campaignId={campaignId} facilityId={facilityId} accountId={accountId} plan={plan}
          onStart={() => setStarted(count => count + 1)} onChange={() => setChanging(true)} onRegistered={onRegistered} />}
    </div>
  )
}

function TodayWork({ campaignId, facilityId, accountId, plan, onStart, onChange, onRegistered }: {
  readonly campaignId: string
  readonly facilityId: string
  readonly accountId: string | undefined
  readonly plan: OutreachPlan | undefined
  readonly onStart: () => void
  readonly onChange: () => void
  readonly onRegistered: (visit: OutreachVisit) => void
}) {
  const settings = useSavedDay(accountId, facilityId, campaignId)
  if (settings === undefined) return <LoadingRows rows={2} label="Loading your station" />
  const onePerson = plan?.stationMode === 'one_person'
  if (!plan || !settings?.siteId || (!onePerson && !settings.station)) return <DayStart campaignId={campaignId} onStart={onStart} />
  const site = plan.sites.find(entry => entry.id === settings.siteId)
  const station = settings.station
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-tray px-4 py-2.5">
        <p className="m-0 inline-flex min-w-0 flex-wrap items-center gap-x-2 text-[14px] text-ink">
          <MapPin className="size-4 shrink-0 text-ink-3" aria-hidden />
          <span className="font-semibold">{site?.name ?? 'Your site'}</span>
          <span className="text-ink-2">· {onePerson ? 'Everything on this device' : stationLabel(station)}</span>
        </p>
        <Button size="sm" onClick={onChange}>Change</Button>
      </div>
      {onePerson ? <AllInOne campaignId={campaignId} />
        : station === 'register' ? <RegisterPerson campaignId={campaignId} onDone={onRegistered} />
          : station ? <StationWork campaignId={campaignId} station={station} /> : null}
    </>
  )
}

/** The day's site and station as kept on this device: undefined while read, null when none is kept. */
function useSavedDay(accountId: string | undefined, facilityId: string, campaignId: string): DaySettings | null | undefined {
  const [saved, setSaved] = useState<DaySettings | null | undefined>(undefined)
  useEffect(() => {
    if (!accountId) { setSaved(null); return }
    let live = true
    void outreachQueueStore().then(store => readDaySettings(store, { accountId, facilityId }, campaignId))
      .then(found => { if (live) setSaved(found) }, () => { if (live) setSaved(null) })
    return () => { live = false }
  }, [accountId, facilityId, campaignId])
  return saved
}
