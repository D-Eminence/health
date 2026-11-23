import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrCard, EhrEmptyState, EhrErrorState, EhrSkeleton } from '@hid/ui/ehr'
import {
  orderRoutesApi, staffApi, type Facility, type LabWorkItem, type PharmacyWorkItem, type ReceivingAnswer, type ReceivingService,
  type SentWrongPatientOrderRoute, type SentWrongPatientOrderRoutes,
} from '../../staff/api'
import { useStaff, type ActivePatient } from '../../staff/App'
import { refusalText } from '../../staff/fieldProblem'
import {
  holdsReceivePermission, orderWord, receivingAnswer, receivingHere, rememberedReceiving, rememberReceiving, routeDay,
} from '../../staff/orderRoutes'
import { learnWrongPatientServed } from '../../wrongPatientServed'
import { learnLateCorrectionServed, saysLateCorrection, useLateCorrectionServed } from '../../lateCorrectionServed'
import { useAccessRequests } from '../frame/attention'
import { STAGE_LABEL, stageOf } from '../departments/laboratory/stage'
import { roleLabels } from '../../staff/staffAccess'
import { loginOpensSite, siteOf, siteServing, SITE_PRODUCT_NAMES } from '../../productSites'
import { Badge, Button, Card, CardHeader, ListRow } from '../../kasuwa/ui'
import { ChevronRight, Hospital, LayoutGrid, ScanText } from 'lucide-react'
import { withdrawnReasonOf } from '../departments/pharmacy/pharmacyText'

/**
 * Home's live cards. Each reads what today's Overview or work pages read, under the same permissions, with the same
 * rules and words (staff/routes/Dashboard.tsx and Operations.tsx, ported here because they are not exported): nothing
 * is read that today's pages would not read, and each audited read happens once, when Home opens.
 */

/** Needs attention's live lines (screens/roles: title, then "Workspace · status"): access requests and the current patient. */
export function AttentionLines({ activePatient }: { readonly activePatient: ActivePatient | null }) {
  const read = useAccessRequests()
  return <>
    {read.state === 'loading' ? <li className="hid-ehr-blue-list-item"><EhrSkeleton label="Loading access requests" bars={1} /></li> : null}
    {read.state === 'failed' ? <li className="hid-ehr-blue-list-item"><strong>Access requests could not be loaded</strong>
      <span className="hid-ehr-blue-muted">{read.message}</span></li> : null}
    {read.state === 'ready' ? (
      <li className="hid-ehr-blue-list-item">
        <Link to="/provider/requests" className="hid-ehr-blue-worklink"><strong>{read.pending} pending access request{read.pending === 1 ? '' : 's'}</strong></Link>
        <span className="hid-ehr-blue-muted">Access request · waiting for the patient to answer</span>
      </li>
    ) : null}
    {activePatient ? (
      <li className="hid-ehr-blue-list-item">
        <Link to="/provider/clinical" className="hid-ehr-blue-worklink"><strong>{activePatient.lookup.patient.fullName ?? activePatient.hid}</strong></Link>
        <span className="hid-ehr-blue-muted">{activePatient.purpose === 'emergency' ? 'Consultation · emergency access, read only' : 'Consultation · open'}</span>
      </li>
    ) : null}
  </>
}

// --- Incoming orders (Novu, P4c): today's Overview rules (readsIncoming, incomingServices, IncomingOrdersCard). ---

function readsIncoming(facility: Facility | undefined, service: ReceivingService): boolean {
  if (!facility || !holdsReceivePermission(facility, service)) return false
  const session = receivingHere(facility, service)
  const remembered = rememberedReceiving(facility, service)
  if (remembered?.receives === true) return true
  if (remembered?.receives === false) return remembered.routesHere ? remembered.routesHere.waiting : session === 'yes'
  return session !== 'no' || remembered?.routesHere?.waiting === true
}

export function useIncomingServices(facility: Facility | undefined) {
  const permissions = facility?.permissions ?? []
  return useMemo(() => {
    const services = (['lab', 'pharmacy'] as const).filter(service => readsIncoming(facility, service))
    return { services, unsure: services.filter(service => receivingHere(facility, service) !== 'yes'),
      sure: services.filter(service => receivingHere(facility, service) === 'yes') }
    // Decided once for the facility and membership, as today's Overview decides it.
  }, [facility?.id, facility?.membershipId, permissions.join(' '), facility?.selfService?.review, facility?.selfService?.organizationType])
}

export function IncomingOrdersCard({ facility, services, unsure, sure }: { readonly facility: Facility; readonly services: readonly ReceivingService[]
  readonly unsure: readonly ReceivingService[]; readonly sure: readonly ReceivingService[] }) {
  const [counts, setCounts] = useState<Partial<Record<ReceivingService, number | 'failed' | 'missing'>>>({})
  const [known, setKnown] = useState<Partial<Record<ReceivingService, ReceivingAnswer | null>>>({})
  const { id: facilityId, membershipId, name: facilityName } = facility
  const wanted = services.join(',')
  useEffect(() => {
    let active = true
    setCounts({}); setKnown({})
    for (const service of wanted.split(',').filter(Boolean) as ReceivingService[]) {
      void orderRoutesApi.incoming(facilityId, service).then(
        answer => {
          rememberReceiving({ id: facilityId, membershipId }, service, answer)
          if (!active) return
          setCounts(current => ({ ...current, [service]: Array.isArray(answer?.items) ? answer.items.length : 0 }))
          setKnown(current => ({ ...current, [service]: receivingAnswer(answer) }))
        },
        caught => { if (active) setCounts(current => ({ ...current, [service]: isHidApiError(caught) && caught.status === 404 ? 'missing' : 'failed' })) })
    }
    return () => { active = false }
  }, [facilityId, membershipId, wanted])
  const shown = services.filter(service => {
    const count = counts[service]
    if (count === 'missing') return false
    const receives = known[service]?.receives
    if (receives === true) return true
    if (receives === false) return typeof count === 'number' && count > 0 && (known[service]?.routesHere !== undefined || sure.includes(service))
    return !unsure.includes(service) || (typeof count === 'number' && count > 0)
  })
  if (shown.length === 0) return null
  return (
    <EhrCard title="Incoming orders">
      {shown.map(service => {
        const count = counts[service]
        const what = service === 'lab' ? 'lab request' : 'prescription'
        return <p key={service}>{count === undefined ? 'Loading…' : count === 'failed' ? `Incoming ${what}s could not be loaded.`
          : `${count} ${what}${count === 1 ? '' : 's'} from other facilities waiting at ${facilityName}`}</p>
      })}
      {shown.map(service => <Link key={service} to={service === 'lab' ? '/provider/laboratory' : '/provider/pharmacy'} className="hid-ehr-blue-link">
        {service === 'lab' ? 'Open Laboratory →' : 'Open Pharmacy →'}</Link>)}
    </EhrCard>
  )
}

// --- Orders accepted for the wrong person (item 3, D10, D17, C28): today's WrongPatientOrdersCard, word for word. ---

function withdrawnText(item: SentWrongPatientOrderRoute, patient: string): string {
  if (item.kind === 'prescription') return item.dispensingReversed
    ? `The dispensing it recorded was reversed: check with ${patient} before you prescribe it again.`
    : 'It had no dispensing on record that needed reversing.'
  const count = Number.isSafeInteger(item.resultsWithdrawn) ? item.resultsWithdrawn : 0
  return count > 0 ? `${count} result${count === 1 ? '' : 's'} it had sent back ${count === 1 ? 'was' : 'were'} withdrawn: do `
    + `not use ${count === 1 ? 'it' : 'them'}, and tell ${patient} that a result they may have seen was not theirs.`
    : 'No result had come back from it.'
}

function withdrewSomething(item: SentWrongPatientOrderRoute): boolean {
  return item.dispensingReversed === true || (Number.isSafeInteger(item.resultsWithdrawn) && item.resultsWithdrawn > 0)
}

function reportedText(item: SentWrongPatientOrderRoute, receiving: string, patient: string): string {
  if (item.late !== true) return `${receiving} reports that it accepted it for someone who was not ${patient}, and ended it on `
    + `${routeDay(item.endedAt)}.`
  const when = routeDay(typeof item.reportedAt === 'string' ? item.reportedAt : item.endedAt)
  return withdrewSomething(item)
    ? `${receiving} reports that it accepted it for someone who was not ${patient}, and on ${when} withdrew what it had sent `
      + `back. Anything you recorded from it still shows to ${patient} until you amend it.`
    : `${receiving} reports that it accepted it for someone who was not ${patient}, and reported this on ${when}.`
}

function othersText(others: SentWrongPatientOrderRoutes['others'], own: number): string {
  const references = Array.isArray(others.references) ? others.references.filter(reference => typeof reference === 'string') : []
  const more = others.count - references.length
  const listed = [...references, ...(more > 0 ? [`${more} more`] : [])]
  const named = listed.length > 1 ? `${listed.slice(0, -1).join(', ')} and ${listed.at(-1)}` : listed[0] ?? ''
  return `${others.count} ${own > 0 ? 'more ' : ''}order${others.count === 1 ? '' : 's'} that `
    + `${others.count === 1 ? 'a colleague' : 'colleagues'} sent from this facility ${others.count === 1 ? 'was' : 'were'} `
    + `reported accepted for the wrong person${named ? `: ${named}` : ''}.`
}

/**
 * `consultation`: whether this site opens Consultation, where an order is found. A lab's, outreach team's or migration
 * site does not (the frame sends it back Home), so there the card still tells what happened, with no way to open the
 * order that would only come back.
 */
export function WrongPatientOrdersCard({ facilityId, facilityName, consultation = true }: { readonly facilityId: string
  readonly facilityName: string; readonly consultation?: boolean }) {
  const { activePatient } = useStaff()
  const lateServed = useLateCorrectionServed() === true
  const [answer, setAnswer] = useState<SentWrongPatientOrderRoutes | 'failed' | 'missing' | null>(null)
  useEffect(() => {
    let active = true
    setAnswer(null)
    void orderRoutesApi.sentWrongPatient(facilityId).then(
      read => {
        learnWrongPatientServed(true)
        if (saysLateCorrection(read)) learnLateCorrectionServed(true)
        if (active) setAnswer(read && typeof read === 'object' ? read : 'failed')
      },
      caught => {
        const missing = isHidApiError(caught) && caught.status === 404
        if (missing) learnWrongPatientServed(false)
        if (active) setAnswer(missing ? 'missing' : 'failed')
      })
    return () => { active = false }
  }, [facilityId])
  if (answer === null || answer === 'missing') return null
  if (answer === 'failed') return <EhrCard title="Orders accepted for the wrong person">
    <p className="hid-ehr-blue-muted">Orders that a laboratory or pharmacy reported it accepted for the wrong person could not be loaded.
      Open this page again to retry.</p></EhrCard>
  const items = Array.isArray(answer.items) ? answer.items : []
  const others = answer.others && Number.isSafeInteger(answer.others.count) && answer.others.count > 0 ? answer.others : null
  if (items.length === 0 && !others) return null
  const days = Number.isSafeInteger(answer.windowDays) && answer.windowDays > 0 ? answer.windowDays : 30
  // Only the record open now can open an order from here; any other is opened through Patient access.
  const openPatient = activePatient?.purpose === 'direct-care' ? activePatient.lookup.patient.patientId : null
  return (
    <EhrCard title="Orders accepted for the wrong person">
      <p className="hid-ehr-blue-muted">In the last {days} days, a laboratory or pharmacy reported that it accepted these orders from
        {' '}{facilityName} for someone who was not the patient, and {lateServed ? 'ended them or reported it later' : 'ended them'}.
        {' '}Health ID does not alert you any other way.</p>
      {items.length > 0 && <ul className="hid-ehr-blue-list">{items.map(item => {
        const patient = item.patient?.name?.trim() || 'the patient'
        const receiving = item.receivingFacility?.name?.trim() || 'The other facility'
        const what = orderWord(item.kind)
        const link = item.link
        return <li key={item.routeId} className="hid-ehr-blue-list-item">
          <strong>{what.charAt(0).toUpperCase()}{what.slice(1)}{item.reference ? ` · Ref ${item.reference}` : ''} · {patient}</strong>
          <p>{reportedText(item, receiving, patient)}</p>
          {(item.late !== true || withdrewSomething(item)) && <p>{withdrawnText(item, patient)}</p>}
          {link && consultation && (openPatient === link.patientId
            ? <Link to="/provider/clinical" state={{ order: link }} className="hid-ehr-blue-link">Open the {what} →</Link>
            : <p className="hid-ehr-blue-muted">To see it, open {patient}’s record from <Link to="/provider/patients"
              className="hid-ehr-blue-link">Patients</Link>, then the {what}{item.reference ? ` with reference ${item.reference}` : ''}.</p>)}
        </li>
      })}</ul>}
      {others && <p>{othersText(others, items.length)} Only the clinician who sent each one sees it here in full.</p>}
    </EhrCard>
  )
}

// --- Lab and pharmacy work: what today's Laboratory and Pharmacy pages list, a few rows each. ---

function workError(error: unknown): string {
  return refusalText(error, 'Work could not be loaded.')
}

export type WorkRead<T> = { state: 'off' } | { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; items: readonly T[] }

export function useWork<T>(facilityId: string, enabled: boolean, load: (id: string) => Promise<{ items: T[] }>): WorkRead<T> {
  const [read, setRead] = useState<WorkRead<T>>({ state: enabled ? 'loading' : 'off' })
  useEffect(() => {
    if (!enabled) {
      setRead({ state: 'off' })
      return
    }
    let active = true
    setRead({ state: 'loading' })
    void load(facilityId).then(
      answer => { if (active) setRead({ state: 'ready', items: Array.isArray(answer?.items) ? answer.items : [] }) },
      caught => { if (active) setRead({ state: 'failed', message: workError(caught) }) })
    return () => { active = false }
  }, [facilityId, enabled, load])
  return read
}

export const loadLab = (id: string) => staffApi.labWorkItems(id)
export const loadPharmacy = (id: string) => staffApi.pharmacyWorkItems(id)

/**
 * Today (screens/roles): the facility's laboratory and pharmacy work, as today's Laboratory and Pharmacy pages list it,
 * each line the design's "title, then Workspace · status". No patient is named here: the work pages say who it is.
 */
export function TodayCard({ facilityId, lab, pharmacy }: { readonly facilityId: string; readonly lab: boolean; readonly pharmacy: boolean }) {
  const labRead = useWork<LabWorkItem>(facilityId, lab, loadLab)
  const pharmacyRead = useWork<PharmacyWorkItem>(facilityId, pharmacy, loadPharmacy)
  const lines = [
    ...(labRead.state === 'ready' ? labRead.items.slice(0, 5).map(item => ({ key: `lab-${item.id}`, title: item.testName ?? 'Lab test',
      meta: `Laboratory · ${STAGE_LABEL[stageOf(item)]}`, to: '/provider/laboratory' })) : []),
    // Work withdrawn by the prescribing team (0133) is neither to dispense nor dispensed: it is left out here.
    ...(pharmacyRead.state === 'ready' ? pharmacyRead.items.filter(item => !withdrawnReasonOf(item)).slice(0, 5).map(item => ({ key: `rx-${item.id}`, title: item.medication?.display ?? 'Medicine',
      meta: `Pharmacy · ${item.dispensing && !item.dispensing.reversed ? 'dispensed' : 'to dispense'}`, to: '/provider/pharmacy' })) : []),
  ]
  const loading = labRead.state === 'loading' || pharmacyRead.state === 'loading'
  const failures = [
    labRead.state === 'failed' ? { what: 'Laboratory work could not be loaded', message: labRead.message } : null,
    pharmacyRead.state === 'failed' ? { what: 'Pharmacy work could not be loaded', message: pharmacyRead.message } : null,
  ].filter(failure => failure !== null)
  return (
    <EhrCard title="Today">
      {failures.map(failure => <EhrErrorState key={failure.what} title={failure.what} message={failure.message} />)}
      {loading ? <EhrSkeleton label="Loading today's work" bars={2} /> : null}
      {!loading && lines.length === 0 && failures.length === 0 ? (
        <EhrEmptyState title={lab || pharmacy ? 'No accepted work yet' : 'Nothing scheduled for you'}
          message={lab || pharmacy ? 'Tests and prescriptions appear here once they are accepted.' : 'Laboratory and pharmacy work shows here for roles that do it.'} />
      ) : null}
      {lines.length > 0 ? <ul className="hid-ehr-blue-list">{lines.map(line => (
        <li key={line.key} className="hid-ehr-blue-list-item">
          <Link to={line.to} className="hid-ehr-blue-worklink"><strong>{line.title}</strong></Link>
          <span className="hid-ehr-blue-muted">{line.meta}</span>
        </li>
      ))}</ul> : null}
    </EhrCard>
  )
}

/**
 * Today, away from the demo facilities: links to the work pages the member may open, and no read. Today's Overview
 * reads no laboratory or pharmacy work, and each such read is audited, so Home makes none either.
 */
export function TodayLinks({ lab, pharmacy }: { readonly lab: boolean; readonly pharmacy: boolean }) {
  return (
    <EhrCard title="Today">
      {lab || pharmacy ? (
        <ul className="hid-ehr-blue-list">
          {lab ? <li className="hid-ehr-blue-list-item"><Link className="hid-ehr-blue-link" to="/provider/laboratory">Laboratory</Link></li> : null}
          {pharmacy ? <li className="hid-ehr-blue-list-item"><Link className="hid-ehr-blue-link" to="/provider/pharmacy">Pharmacy</Link></li> : null}
        </ul>
      ) : <p className="hid-ehr-blue-muted">Nothing scheduled for you</p>}
    </EhrCard>
  )
}

// --- The classic Overview's own cards (staff/routes/Dashboard.tsx), in its words (parity report 3.3-54, 3.3-56, 3.3-57). ---

/**
 * "Active facility": the facility worked at and the person's roles there as a badge, in classic's words: a role the
 * list does not name reads "Staff" ("Doctor, Staff": roleLabels), never its code (Dashboard.tsx).
 */
export function ActiveFacilityCard({ facility }: { readonly facility: Facility }) {
  return <Card aria-labelledby="hid-ehr-blue-active-facility">
    <CardHeader as="h2" titleId="hid-ehr-blue-active-facility" title="Active facility" icon={Hospital} />
    <div className="flex flex-col items-start gap-2 px-5 py-4">
      <p className="m-0 text-sm text-ink">{facility.name}</p>
      <Badge tone="info" size="sm">{roleLabels(facility.roles) || 'Staff'}</Badge>
    </div>
  </Card>
}

/**
 * The classic Overview's workspaces, each under the permission it lists by (Dashboard.tsx `modules`, copied: that list
 * is not exported). Only the permission decides, as there; which of them open on this site is the caller's.
 */
export const WORKSPACES = [
  { title: 'Patient access', to: '/provider/patients', permission: 'identity.patient.read', detail: 'Look up a Health ID after consent, patient PIN, or emergency authorization.' },
  { title: 'Clinical record', to: '/provider/clinical', permission: 'ehr.encounter.read', detail: 'Document encounters, observations, diagnoses, prescriptions, and lab requests.' },
  { title: 'Laboratory', to: '/provider/laboratory', permission: 'lab.work-item.read', detail: 'Review accepted test work and create specimen accessions.' },
  { title: 'Pharmacy', to: '/provider/pharmacy', permission: 'pharmacy.work-item.read', detail: 'Review accepted prescriptions and confirm dispensing.' },
  { title: 'Document OCR', to: '/provider/ocr', permission: 'ocr.job.read', detail: 'Follow extraction jobs for governed clinical documents.' },
  { title: 'Outreach', to: '/provider/outreach', permission: 'outreach.registration.read', detail: 'Review facility campaign registration work.' },
] as const

/**
 * "Workspaces": the classic Overview's grid of the workspaces this role holds that open on this site (`opens`), with
 * its notes: none of the clinical workspaces held; the others on another Health ID site this login opens, linked in the
 * sidebar; none here at all. The first note drops classic's "module permissions" for plain words (house rule: no
 * "permission" on blue staff screens); the others are classic's own.
 */
export function WorkspacesCard({ permissions, products, opens }: {
  readonly permissions: readonly string[]
  readonly products: unknown
  readonly opens: (path: string) => boolean
}) {
  const held = WORKSPACES.filter(workspace => permissions.includes(workspace.permission))
  const here = held.filter(workspace => opens(workspace.to.replace(/^\/provider\/?/, '')))
  const hostname = window.location.hostname
  const elsewhere = held.some(workspace => {
    const site = siteServing(workspace.to, hostname)
    return site !== null && loginOpensSite(site.key, products)
  })
  const noneHere = held.length > 0 && here.length === 0 && !elsewhere
  const site = siteOf(hostname)
  const productName = site ? SITE_PRODUCT_NAMES[site.key] : 'Health ID'
  return <Card aria-labelledby="hid-ehr-blue-workspaces">
    <CardHeader as="h2" titleId="hid-ehr-blue-workspaces" title="Workspaces" icon={LayoutGrid} />
    {here.length > 0 ? <ul className="m-0 list-none divide-y divide-line p-0">
      {here.map(workspace => <li key={workspace.to}>
        <ListRow to={workspace.to} title={workspace.title} subtitle={workspace.detail}
          trailing={<span className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-ink">Open workspace<ChevronRight className="size-4" aria-hidden /></span>} />
      </li>)}
    </ul> : null}
    {held.length === 0 || elsewhere || noneHere ? <div className="flex flex-col gap-2 px-5 py-4 text-[13px] text-ink-3">
      {held.length === 0 ? <p className="m-0">Your active facility has no clinical modules for your role. Ask an administrator to review your assignment.</p> : null}
      {elsewhere ? <p className="m-0">Your other workspaces are on other Health ID sites, linked in the sidebar.</p> : null}
      {noneHere ? <p className="m-0">Your role has no workspace in {productName}. Ask an administrator to review your assignment.</p> : null}
    </div> : null}
  </Card>
}

/**
 * "Health ID Migrate": the classic Overview's card for a role that reads document jobs (ocr.job.read), where this site
 * opens Document OCR. No role holds it at launch (hid-system 0091), so it shows nowhere yet.
 */
export function MigrateCard() {
  return <Card aria-labelledby="hid-ehr-blue-migrate">
    <CardHeader as="h2" titleId="hid-ehr-blue-migrate" title="Health ID Migrate" icon={ScanText} />
    <p className="m-0 px-5 pt-4 text-sm text-ink-2">Document capture, extraction, validation, and publication.</p>
    <div className="px-5 pb-4 pt-2"><Button to="/provider/ocr" variant="link" size="sm" iconRight={ChevronRight}>Open document workflow</Button></div>
  </Card>
}
