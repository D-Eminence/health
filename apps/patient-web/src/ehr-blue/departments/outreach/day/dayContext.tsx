import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import { useStaff } from '../../../../staff/App'
import { staffApi, type OutreachCase } from '../../../../staff/api'
import { useDeptAccess } from '../../parts/access'
import { campaignFlowErrorText, isNotOffered, outreachCampaignApi, sendStationCommand, type StationCommand, type StationCommandAnswer } from '../campaignApi'
import type { CampaignTeamMember, OutreachPlan, OutreachVisit, StationKind, TeamRole, VitalId } from '../campaignTypes'
import type { OutcomeInputs } from '../screeningTemplates'
import { isOutreachGroup } from '../outreachGroup'
import { outreachQueueStore, useDaySettings, useOutreachQueue, waitsForNetwork, type DaySettings, type DaySettingsChange, type StationWriteTarget } from '../offlineQueue'

/*
 * What every field-day screen of one campaign shares (DayStart, RegisterPerson, StationWork, AllInOne, VisitView): the
 * working facility and account, the campaign's plan, the caller's roles in it, the day settings remembered on this
 * device (site, station, kit lots), the offline queue, whether the device is online, the people seen at this station
 * today, and each person's half-entered values. All in memory while the screen lives, except what offlineQueue.ts keeps.
 *
 * Each exported screen wraps itself in DayScope, which reuses the scope of a screen around it for the same campaign
 * (AllInOne holds RegisterPerson and the station forms under one), so the plan is read once and drafts are shared.
 */

export type Read<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  /** Not served yet (404 not offered), or no plan saved: a quiet empty state, no disclaimer. */
  | { readonly status: 'none'; readonly reason: 'not_offered' | 'no_plan' }
  | { readonly status: 'error'; readonly message: string }

/** The person a station works on: a visit Outreach has, or a registration still waiting on this device. */
export type DayVisit =
  | { readonly kind: 'case'; readonly key: string; readonly caseId: string; readonly visit: OutreachVisit }
  | { readonly kind: 'queued'; readonly key: string; readonly registrationCommandId: string; readonly temporaryPatientId: string; readonly person: QueuedPerson }

export interface QueuedPerson {
  readonly fullName: string
  readonly sex: string
  readonly ageYears: number
  readonly phone: string | null
}

export function caseVisit(visit: OutreachVisit): DayVisit {
  return { kind: 'case', key: visit.id, caseId: visit.id, visit }
}

/** Name, age, sex and code of the person, whichever kind of visit. */
export function personOf(visit: DayVisit) {
  if (visit.kind === 'case') {
    const { fullName, sex, ageYears, visitCode, healthId, phone } = visit.visit
    return { fullName: fullName ?? 'Name not recorded', sex: sex ?? null, ageYears: ageYears ?? null, visitCode: visitCode ?? null,
      healthId: healthId ?? null, phone: phone ?? null }
  }
  const { fullName, sex, ageYears, phone } = visit.person
  return { fullName, sex, ageYears, visitCode: null, healthId: null, phone }
}

/** A problem said to the person as it is: its message is plain words. */
export class DayProblem extends Error {}

export type SaveResult = { readonly state: 'sent'; readonly answer: StationCommandAnswer } | { readonly state: 'queued' }

export interface CampaignDayValue {
  readonly campaignId: string
  /** The campaign's name, for the slip; the organisation's when the campaigns can't be read. */
  readonly campaignName: string
  readonly facilityId: string
  readonly accountId: string | undefined
  /** The signed-in person's name: the witness of a consent given out loud. */
  readonly staffName: string
  /** An outreach group's own facility: its registrations wait on this device when they can't be sent. */
  readonly group: boolean
  readonly online: boolean
  readonly plan: Read<OutreachPlan>
  readonly refreshPlan: () => void
  /** The caller's roles in this campaign (none when the team can't be read). */
  readonly roles: readonly TeamRole[]
  /** The team, for who recorded what. */
  readonly members: readonly CampaignTeamMember[]
  readonly settings: DaySettings | null
  readonly saveSettings: (change: DaySettingsChange) => Promise<DaySettings | null>
  readonly queue: ReturnType<typeof useOutreachQueue>
  /** Writes and registrations still waiting on this device; those Health ID refused. */
  readonly waiting: number
  readonly refused: number
  /**
   * Saves one station write: sent now when online and the person has a case, else kept in the queue (and sent when the
   * network is back). The same localCommandId every time for the same write, so it is recorded once. Throws Health ID's
   * refusal (said with campaignFlowErrorText).
   */
  readonly saveWrite: (visit: DayVisit, command: StationCommand, localCommandId: string) => Promise<SaveResult>
  /** Half-entered values, by visit and form, while the screen lives. */
  readonly drafts: Map<string, unknown>
  readonly recent: readonly { readonly station: StationKind | 'all'; readonly visit: DayVisit }[]
  readonly remember: (station: StationKind | 'all', visit: DayVisit) => void
  /** Registrations sent from the queue since this screen opened, by their temporary patient id. */
  readonly synced: ReadonlyMap<string, OutreachVisit>
}

const DayContext = createContext<CampaignDayValue | null>(null)

export function useCampaignDay(): CampaignDayValue {
  const day = useContext(DayContext)
  if (!day) throw new Error('useCampaignDay is used inside DayScope only.')
  return day
}

/** Wraps a field-day screen: reuses the scope around it for the same campaign, or opens one. */
export function DayScope({ campaignId, children }: { readonly campaignId: string; readonly children: ReactNode }) {
  const outer = useContext(DayContext)
  if (outer?.campaignId === campaignId) return <>{children}</>
  return <DayProvider campaignId={campaignId}>{children}</DayProvider>
}

/** Whether the browser says it is online; true where it can't say. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

function DayProvider({ campaignId, children }: { readonly campaignId: string; readonly children: ReactNode }) {
  const { facility, facilityId = '', actorId, permissions } = useDeptAccess()
  const readsCampaigns = permissions.includes('outreach.campaign.read')
  const { state } = useStaff()
  const staffName = state.status === 'ready' ? state.session.actor.displayName?.trim() || state.session.actor.email || 'Team member' : 'Team member'
  const group = isOutreachGroup(facility)
  const online = useOnline()

  const [plan, setPlan] = useState<Read<OutreachPlan>>({ status: 'loading' })
  const [planRead, setPlanRead] = useState(0)
  useEffect(() => {
    if (!facilityId) return
    const abort = new AbortController()
    setPlan(previous => previous.status === 'ready' ? previous : { status: 'loading' })
    outreachCampaignApi.plan(facilityId, campaignId, abort.signal).then(
      value => { if (!abort.signal.aborted) setPlan({ status: 'ready', value }) },
      (caught: unknown) => {
        if (abort.signal.aborted) return
        if (isNotOffered(caught)) setPlan({ status: 'none', reason: 'not_offered' })
        else if (isHidApiError(caught) && caught.code === 'OUTREACH_PLAN_NOT_FOUND') setPlan({ status: 'none', reason: 'no_plan' })
        else setPlan(previous => previous.status === 'ready' ? previous : { status: 'error', message: campaignFlowErrorText(caught, 'The campaign plan could not be read. Try again.') })
      })
    return () => abort.abort()
  }, [facilityId, campaignId, planRead])
  const refreshPlan = useCallback(() => setPlanRead(count => count + 1), [])

  const [roles, setRoles] = useState<readonly TeamRole[]>([])
  const [members, setMembers] = useState<readonly CampaignTeamMember[]>([])
  useEffect(() => {
    if (!facilityId) return
    const abort = new AbortController()
    outreachCampaignApi.team(facilityId, campaignId, abort.signal).then(
      team => { if (!abort.signal.aborted) { setRoles(team.you?.roles ?? []); setMembers(team.members) } },
      () => { if (!abort.signal.aborted) setRoles([]) })
    return () => abort.abort()
  }, [facilityId, campaignId])

  const [listedName, setListedName] = useState<string | null>(null)
  useEffect(() => {
    if (!facilityId || !readsCampaigns) return
    let live = true
    staffApi.outreachCampaigns(facilityId).then(
      campaigns => { if (live) setListedName(campaigns.find(campaign => campaign.id === campaignId)?.name ?? null) },
      () => undefined)
    return () => { live = false }
  }, [facilityId, campaignId, readsCampaigns])
  const campaignName = listedName ?? (plan.status === 'ready' ? plan.value.organisationName : '') ?? ''

  const { settings, save: saveSettings } = useDaySettings(actorId, facilityId, campaignId)

  const [synced, setSynced] = useState<ReadonlyMap<string, OutreachVisit>>(() => new Map())
  const onSynced = useCallback((created: OutreachCase) => {
    const temporary = created?.temporaryPatientId
    if (!temporary) return
    setSynced(previous => new Map(previous).set(temporary, created as OutreachVisit))
  }, [])
  const queue = useOutreachQueue(actorId, facilityId, onSynced)

  const saveWrite = useCallback(async (given: DayVisit, command: StationCommand, localCommandId: string): Promise<SaveResult> => {
    // A registration kept on this phone that has since been sent goes to the case Outreach made for it.
    const sent = given.kind === 'queued' ? synced.get(given.temporaryPatientId) : undefined
    const visit = sent ? caseVisit(sent) : given
    if (visit.kind === 'queued') {
      const store = await outreachQueueStore()
      const still = (await store.list().catch(() => [])).some(entry => entry.localCommandId === visit.registrationCommandId)
      if (!still) throw new DayProblem('Their registration was just sent from this phone. Find them by their visit code to carry on.')
    }
    const target: StationWriteTarget = visit.kind === 'case' ? { caseId: visit.caseId } : { registrationCommandId: visit.registrationCommandId }
    if (visit.kind === 'case' && online) {
      try {
        return { state: 'sent', answer: await sendStationCommand(facilityId, visit.caseId, command, localCommandId) }
      } catch (caught) {
        if (!waitsForNetwork(caught) || !actorId) throw caught
      }
    }
    const queued = await queue.addWrite(campaignId, target, command, localCommandId)
    if (!queued) throw new DayProblem('This phone can’t keep it. Try again when you have a connection.')
    return { state: 'queued' }
  }, [online, facilityId, actorId, queue, campaignId, synced])

  const drafts = useRef(new Map<string, unknown>()).current
  const [recent, setRecent] = useState<CampaignDayValue['recent']>([])
  const remember = useCallback((station: StationKind | 'all', visit: DayVisit) => {
    setRecent(previous => [{ station, visit }, ...previous.filter(item => !(item.station === station && item.visit.key === visit.key))].slice(0, 12))
  }, [])

  const waiting = queue.entries.filter(entry => entry.state === 'waiting').length + queue.writes.filter(entry => entry.state === 'waiting').length
  const refused = queue.entries.filter(entry => entry.state === 'refused').length + queue.writes.filter(entry => entry.state === 'refused').length

  const value = useMemo<CampaignDayValue>(() => ({
    campaignId, campaignName, facilityId, accountId: actorId, staffName, group, online, plan, refreshPlan, roles, members, settings, saveSettings, queue,
    waiting, refused, saveWrite, drafts, recent, remember, synced,
  }), [campaignId, campaignName, facilityId, actorId, staffName, group, online, plan, refreshPlan, roles, members, settings, saveSettings, queue, waiting, refused,
    saveWrite, drafts, recent, remember, synced])
  return <DayContext.Provider value={value}>{children}</DayContext.Provider>
}

/** A draft kept for one visit and form while the screen lives: never lost when the person goes to another screen and back. */
export function useDraft<T>(key: string, initial: () => T): readonly [T, (next: T | ((previous: T) => T)) => void] {
  const { drafts } = useCampaignDay()
  const [value, setValue] = useState<T>(() => (drafts.has(key) ? drafts.get(key) as T : initial()))
  const [shownKey, setShownKey] = useState(key)
  if (shownKey !== key) {
    // Another visit opened in the same form: its own draft.
    setShownKey(key)
    setValue(drafts.has(key) ? drafts.get(key) as T : initial())
  }
  const set = useCallback((next: T | ((previous: T) => T)) => {
    setValue(previous => {
      const value = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
      drafts.set(key, value)
      return value
    })
  }, [drafts, key])
  return [value, set] as const
}

/** Forgets a visit's drafts once saved. */
export function clearDrafts(drafts: Map<string, unknown>, visitKey: string) {
  for (const key of [...drafts.keys()]) if (key.startsWith(`${visitKey}|`)) drafts.delete(key)
}

/** Where a witnessed HIV agreement given at registration waits for the HIV test on this phone. */
export function hivConsentKey(visitKey: string): string {
  return `${visitKey}|hiv-consent`
}

/** What this phone recorded for a visit (sent or waiting), so the outcome can be suggested before the visit is read again. */
export interface LocalRecord {
  readonly vitals: Partial<Record<VitalId, number>>
  readonly fasting?: boolean
  readonly tests: ReadonlyArray<{ readonly testId: string; readonly result?: string; readonly value?: number; readonly attempt: number }>
  readonly answers: ReadonlyArray<{ readonly questionId: string; readonly value: string }>
}

const EMPTY_RECORD: LocalRecord = { vitals: {}, tests: [], answers: [] }

export function localRecord(drafts: Map<string, unknown>, visitKey: string): LocalRecord {
  return (drafts.get(`${visitKey}|recorded`) as LocalRecord | undefined) ?? EMPTY_RECORD
}

export function addToRecord(drafts: Map<string, unknown>, visitKey: string, change: Partial<LocalRecord>) {
  const before = localRecord(drafts, visitKey)
  const answers = new Map(before.answers.map(answer => [answer.questionId, answer]))
  for (const answer of change.answers ?? []) answers.set(answer.questionId, answer)
  drafts.set(`${visitKey}|recorded`, {
    vitals: { ...before.vitals, ...change.vitals },
    fasting: change.fasting ?? before.fasting,
    tests: [...before.tests, ...(change.tests ?? [])],
    answers: [...answers.values()],
  } satisfies LocalRecord)
}

/** What the outcome is suggested from: the visit as Outreach sent it, with what this phone recorded since. */
export function outcomeInputsOf(visit: DayVisit, local: LocalRecord, plan: OutreachPlan): OutcomeInputs {
  const server = visit.kind === 'case' ? visit.visit : null
  const vitals: Partial<Record<VitalId, number>> = {}
  let fasting: boolean | undefined
  for (const entry of server?.vitals ?? []) {
    Object.assign(vitals, entry.readings)
    if (entry.fasting !== undefined) fasting = entry.fasting
  }
  Object.assign(vitals, local.vitals)
  const answers = new Map((server?.answers ?? []).map(answer => [answer.questionId, answer]))
  for (const answer of local.answers) answers.set(answer.questionId, answer)
  return {
    vitals, fasting: local.fasting ?? fasting, package: plan.package,
    tests: [...(server?.tests ?? []), ...local.tests],
    answers: [...answers.values()],
  }
}

/** Moves what this phone kept for a visit to its new key (a registration kept on this phone, now sent). */
export function moveDrafts(drafts: Map<string, unknown>, from: string, to: string) {
  if (from === to) return
  for (const [key, value] of [...drafts.entries()]) {
    if (!key.startsWith(`${from}|`)) continue
    drafts.set(`${to}${key.slice(from.length)}`, value)
    drafts.delete(key)
  }
}
