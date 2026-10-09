import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card } from '@hid/ui'
import { staffApi, type AccessRequest } from '../api'
import { useStaff } from '../App'
import { accessRequestsError } from './AccessRequests'

const modules = [
  { title: 'Patient access', to: '/provider/patients', permission: 'identity.patient.read', detail: 'Look up a Health ID after consent, patient PIN, or emergency authorization.' },
  { title: 'Clinical record', to: '/provider/clinical', permission: 'ehr.encounter.read', detail: 'Document encounters, observations, diagnoses, prescriptions, and lab requests.' },
  { title: 'Laboratory', to: '/provider/laboratory', permission: 'lab.work-item.read', detail: 'Review accepted test work and create specimen accessions.' },
  { title: 'Pharmacy', to: '/provider/pharmacy', permission: 'pharmacy.work-item.read', detail: 'Review accepted prescriptions and confirm dispensing.' },
  { title: 'Document OCR', to: '/provider/ocr', permission: 'ocr.job.read', detail: 'Follow extraction jobs for governed clinical documents.' },
  { title: 'Outreach', to: '/provider/outreach', permission: 'outreach.registration.read', detail: 'Review facility campaign registration work.' },
] as const

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
  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Provider workspace</p><h1>Good to see you, {session.actor.displayName?.split(' ')[0] ?? 'colleague'}.</h1><p>Working at {facility?.name ?? 'no selected facility'}. All clinical activity uses your current membership and is checked by the backend.</p></div>
    {!facility && <Card className="staff-card"><h2>Select a facility</h2><p>Choose your active facility above to open permitted workflows.</p></Card>}
    {facility && <div className="staff-grid">
      <Card className="staff-card"><h2>Active facility</h2><p>{facility.name}</p><Badge tone="information">{facility.roles.join(', ') || 'Staff'}</Badge></Card>
      {permissions.includes('identity.consent.write') && <Card className="staff-card"><h2>Access requests</h2><p>{requests ? `${requests.filter(request => request.status === 'pending').length} pending request${requests.filter(request => request.status === 'pending').length === 1 ? '' : 's'}` : loadError || 'Loading requests…'}</p><Link to="/provider/requests" className="staff-text-link">Review requests →</Link></Card>}
      {activePatient && <Card className="staff-card"><h2>Current patient</h2><p>{activePatient.lookup.patient.fullName ?? activePatient.hid}</p><Link to="/provider/clinical" className="staff-text-link">Open clinical record →</Link></Card>}
    </div>}
    <section className="staff-section"><h2>Workspaces</h2><div className="staff-grid">{modules.filter(module => permissions.includes(module.permission)).map(module => <Link className="staff-module" key={module.to} to={module.to}><strong>{module.title}</strong><span>{module.detail}</span><small>Open workspace →</small></Link>)}</div>{facility && modules.every(module => !permissions.includes(module.permission)) && <p className="staff-muted">Your active facility has no clinical module permissions. Ask an administrator to review your assignment.</p>}</section>
    <Card className="staff-card staff-gap-card"><h2>Health ID Migrate</h2><p>Document capture, extraction, validation, and publication use the governed OCR API. Bulk import, project matching, and team operations need additional backend support.</p><Link to="/provider/ocr" className="staff-text-link">Open document workflow →</Link></Card>
  </>
}
