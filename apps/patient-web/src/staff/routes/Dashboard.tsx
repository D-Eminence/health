import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card } from '@hid/ui'
import {
  orderRoutesApi, staffApi, type AccessRequest, type ReceivingService, type SentWrongPatientOrderRoute,
  type SentWrongPatientOrderRoutes,
} from '../api'
import { useStaff } from '../App'
import { accessRequestsError } from './AccessRequests'
import { FacilityCheckCard } from './ReviewBanner'
import { usesNovuBackend } from '../../backendContract'
import { isHidApiError } from '@hid/http'
import { roleLabels } from '../staffAccess'
import { orderWord, receivingHere, routeDay } from '../orderRoutes'

const modules = [
  { title: 'Patient access', to: '/provider/patients', permission: 'identity.patient.read', detail: 'Look up a Health ID after consent, patient PIN, or emergency authorization.' },
  { title: 'Clinical record', to: '/provider/clinical', permission: 'ehr.encounter.read', detail: 'Document encounters, observations, diagnoses, prescriptions, and lab requests.' },
  { title: 'Laboratory', to: '/provider/laboratory', permission: 'lab.work-item.read', detail: 'Review accepted test work and create specimen accessions.' },
  { title: 'Pharmacy', to: '/provider/pharmacy', permission: 'pharmacy.work-item.read', detail: 'Review accepted prescriptions and confirm dispensing.' },
  { title: 'Document OCR', to: '/provider/ocr', permission: 'ocr.job.read', detail: 'Follow extraction jobs for governed clinical documents.' },
  { title: 'Outreach', to: '/provider/outreach', permission: 'outreach.registration.read', detail: 'Review facility campaign registration work.' },
] as const

/**
 * Orders other facilities sent here, waiting to be accepted (Novu, P4c, SPEC-FINAL §13.5), for a member who receives
 * them: a laboratory scientist or a pharmacist, at a laboratory or pharmacy (receivingHere). At a governed facility,
 * whose type the session does not say (`unsure`), a count is shown only when orders are waiting: a hospital's own
 * laboratory or pharmacy is never sent any, so "0 waiting" would promise orders that cannot come. A backend without the
 * route (404) shows no card. Each read is audited, so it is read once, when the Overview opens.
 */
function IncomingOrdersCard({ facilityId, facilityName, services, unsure }: { facilityId: string; facilityName: string
  services: readonly ReceivingService[]; unsure: readonly ReceivingService[] }) {
  const [counts, setCounts] = useState<Partial<Record<ReceivingService, number | 'failed' | 'missing'>>>({})
  const wanted = services.join(',')
  useEffect(() => {
    let active = true
    setCounts({})
    for (const service of wanted.split(',') as ReceivingService[]) {
      void orderRoutesApi.incoming(facilityId, service).then(
        answer => { if (active) setCounts(current => ({ ...current, [service]: Array.isArray(answer?.items) ? answer.items.length : 0 })) },
        caught => { if (active) setCounts(current => ({ ...current, [service]: isHidApiError(caught) && caught.status === 404 ? 'missing' : 'failed' })) })
    }
    return () => { active = false }
  }, [facilityId, wanted])
  const shown = services.filter(service => {
    const count = counts[service]
    if (count === 'missing') return false
    // Where the facility may not receive at all, only orders actually waiting are said.
    return !unsure.includes(service) || (typeof count === 'number' && count > 0)
  })
  if (shown.length === 0) return null
  return <Card className="staff-card"><h2>Incoming orders</h2>
    {shown.map(service => {
      const count = counts[service]
      const what = service === 'lab' ? 'lab request' : 'prescription'
      return <p key={service}>{count === undefined ? 'Loading…' : count === 'failed' ? `Incoming ${what}s could not be loaded.`
        : `${count} ${what}${count === 1 ? '' : 's'} from other facilities waiting at ${facilityName}`}</p>
    })}
    {shown.map(service => <Link key={service} to={service === 'lab' ? '/provider/laboratory' : '/provider/pharmacy'} className="staff-text-link">
      {service === 'lab' ? 'Open Laboratory →' : 'Open Pharmacy →'}</Link>)}
  </Card>
}

/** "1 result it had sent back was withdrawn", or what else became of what came back (item 3, D10). */
function withdrawnText(item: SentWrongPatientOrderRoute, patient: string): string {
  if (item.kind === 'prescription') return item.dispensingReversed
    ? `The dispensing it recorded was reversed: check with ${patient} before you prescribe it again.`
    : 'It had no dispensing on record that needed reversing.'
  const count = Number.isSafeInteger(item.resultsWithdrawn) ? item.resultsWithdrawn : 0
  return count > 0 ? `${count} result${count === 1 ? '' : 's'} it had sent back ${count === 1 ? 'was' : 'were'} withdrawn: do `
    + `not use ${count === 1 ? 'it' : 'them'}, and tell ${patient} that a result they may have seen was not theirs.`
    : 'No result had come back from it.'
}

/**
 * "3 orders that colleagues sent from this facility were reported accepted for the wrong person: AB12CD34, 9F00E1A2 and 1
 * more." The backend gives the member every order they sent in full, so these are only ever colleagues' (C28).
 */
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
 * Orders sent from this facility that the receiving laboratory or pharmacy ended as accepted for someone who was not the
 * patient, in the last 30 days (item 3, owner decision D10's alternative (a), C28): Health ID alerts the ordering clinician
 * no other way. Privacy first: only the member who sent an order sees it in full (the patient's name, what came back and
 * was withdrawn, and a link to the order), whether or not they may still open the patient's record, since the report
 * usually comes after the grant the order was sent under has expired; an order a colleague sent is only counted, with its
 * reference, never a patient's name (the backend decides, C28). Read once when the
 * Overview opens, only for a member holding ehr.order-route.send (each read is audited); nothing is shown when there is
 * none, or where the backend has no such route (404). It lists; nothing on it acts.
 */
function WrongPatientOrdersCard({ facilityId, facilityName }: { facilityId: string; facilityName: string }) {
  const { activePatient } = useStaff()
  const [answer, setAnswer] = useState<SentWrongPatientOrderRoutes | 'failed' | 'missing' | null>(null)
  useEffect(() => {
    let active = true
    setAnswer(null)
    void orderRoutesApi.sentWrongPatient(facilityId).then(
      read => { if (active) setAnswer(read && typeof read === 'object' ? read : 'failed') },
      caught => { if (active) setAnswer(isHidApiError(caught) && caught.status === 404 ? 'missing' : 'failed') })
    return () => { active = false }
  }, [facilityId])
  if (answer === null || answer === 'missing') return null
  if (answer === 'failed') return <Card className="staff-card"><h2>Orders accepted for the wrong person</h2>
    <p className="staff-muted">Orders that a laboratory or pharmacy reported it accepted for the wrong person could not be loaded.
      Open this page again to retry.</p></Card>
  const items = Array.isArray(answer.items) ? answer.items : []
  const others = answer.others && Number.isSafeInteger(answer.others.count) && answer.others.count > 0 ? answer.others : null
  if (items.length === 0 && !others) return null
  const days = Number.isSafeInteger(answer.windowDays) && answer.windowDays > 0 ? answer.windowDays : 30
  // The record open now is the only one an order can be opened in from here: any other is opened through Patient access.
  const openPatient = activePatient?.purpose === 'direct-care' ? activePatient.lookup.patient.patientId : null
  return <Card className="staff-card staff-wrong-patient-orders" aria-labelledby="wrong-patient-orders-title">
    <h2 id="wrong-patient-orders-title">Orders accepted for the wrong person</h2>
    <p className="staff-muted">In the last {days} days, a laboratory or pharmacy reported that it accepted these orders from
      {' '}{facilityName} for someone who was not the patient, and ended them. Health ID does not alert you any other way.</p>
    {items.length > 0 && <ul className="staff-list">{items.map(item => {
      const patient = item.patient?.name?.trim() || 'the patient'
      const receiving = item.receivingFacility?.name?.trim() || 'The other facility'
      const what = orderWord(item.kind)
      const link = item.link
      return <li key={item.routeId} className="staff-list-item staff-stack">
        <strong>{what.charAt(0).toUpperCase()}{what.slice(1)}{item.reference ? ` · Ref ${item.reference}` : ''} · {patient}</strong>
        <p>{receiving} reports that it accepted it for someone who was not {patient}, and ended it on {routeDay(item.endedAt)}.</p>
        <p>{withdrawnText(item, patient)}</p>
        {link && (openPatient === link.patientId
          ? <Link to="/provider/clinical" state={{ order: link }} className="staff-text-link">Open the {what} →</Link>
          : <p className="staff-muted">To see it, open {patient}’s record from <Link to="/provider/patients"
            className="staff-text-link">Patient access</Link>, then the {what}{item.reference ? ` with reference ${item.reference}` : ''}.</p>)}
      </li>
    })}</ul>}
    {others && <p>{othersText(others, items.length)} Only the clinician who sent each one sees it here in full.</p>}
  </Card>
}

export function Dashboard() {
  const { state, activePatient } = useStaff()
  const [requests, setRequests] = useState<AccessRequest[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const session = state.status === 'ready' ? state.session : null
  const facility = session?.actor.facility
  const permissions = facility?.permissions ?? []

  useEffect(() => {
    if (!facility || !permissions.includes('identity.consent.write')) return
    let active = true
    void staffApi.listAccessRequests(facility.id).then(items => { if (active) setRequests(items) })
      .catch(error => { if (active) setLoadError(accessRequestsError(error)) })
    return () => { active = false }
  }, [facility?.id])

  if (!session) return null
  // Who receives orders from other facilities here (Novu, P4c): laboratory scientists and pharmacists, at a laboratory
  // or pharmacy. A hospital or clinic that signed itself up is never sent any, so it reads nothing.
  const receiving = (['lab', 'pharmacy'] as const).filter(service => receivingHere(facility, service) !== 'no')
  const unsure = receiving.filter(service => receivingHere(facility, service) === 'unknown')
  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Provider workspace</p><h1>Good to see you, {session.actor.displayName?.split(' ')[0] ?? 'colleague'}.</h1><p>Working at {facility?.name ?? 'no selected facility'}. All clinical activity uses your current membership and is checked by the backend.</p></div>
    {!facility && <Card className="staff-card"><h2>Select a facility</h2><p>Choose your active facility above to open permitted workflows.</p></Card>}
    {facility && <div className="staff-grid">
      <Card className="staff-card"><h2>Active facility</h2><p>{facility.name}</p><Badge tone="information">{(usesNovuBackend() ? roleLabels(facility.roles) : facility.roles.join(', ')) || 'Staff'}</Badge></Card>
      <FacilityCheckCard facility={facility} />
      {permissions.includes('identity.consent.write') && <Card className="staff-card"><h2>Access requests</h2><p>{requests ? `${requests.filter(request => request.status === 'pending').length} pending request${requests.filter(request => request.status === 'pending').length === 1 ? '' : 's'}` : loadError || 'Loading requests…'}</p><Link to="/provider/requests" className="staff-text-link">Review requests →</Link></Card>}
      {usesNovuBackend() && receiving.length > 0 && <IncomingOrdersCard facilityId={facility.id} facilityName={facility.name} services={receiving} unsure={unsure} />}
      {usesNovuBackend() && permissions.includes('ehr.order-route.send') && <WrongPatientOrdersCard key={facility.id}
        facilityId={facility.id} facilityName={facility.name} />}
      {activePatient && <Card className="staff-card"><h2>Current patient</h2><p>{activePatient.lookup.patient.fullName ?? activePatient.hid}</p><Link to="/provider/clinical" className="staff-text-link">Open clinical record →</Link></Card>}
    </div>}
    <section className="staff-section"><h2>Workspaces</h2><div className="staff-grid">{modules.filter(module => permissions.includes(module.permission)).map(module => <Link className="staff-module" key={module.to} to={module.to}><strong>{module.title}</strong><span>{module.detail}</span><small>Open workspace →</small></Link>)}</div>{facility && modules.every(module => !permissions.includes(module.permission)) && <p className="staff-muted">Your active facility has no clinical module permissions. Ask an administrator to review your assignment.</p>}</section>
    {/* It leads only to Document OCR, which a role without ocr.job.read cannot open: OCR is closed at launch, and no role holds it (hid-system 0091). */}
    {permissions.includes('ocr.job.read') && <Card className="staff-card staff-gap-card"><h2>Health ID Migrate</h2><p>Document capture, extraction, validation, and publication use the governed OCR API. Bulk import, project matching, and team operations need additional backend support.</p><Link to="/provider/ocr" className="staff-text-link">Open document workflow →</Link></Card>}
  </>
}
