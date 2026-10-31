import { useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { EhrBackButton, EhrCard, EhrField, EhrPageHeading, EhrSampleBanner, EhrSelect, EhrStatCard } from '@hid/ui/ehr'
import { useSampleHref } from '../frame/pageContext'
import { useRoleView, type DemoRole } from '../frame/roleView'
import { sampleModule, sampleRecords, sampleTitle, sampleVersion, statusWords, subscribeSamples } from '../frame/sample/store'

/**
 * Each demo role's dashboard (design: screens/roles), as a sample: the workspaces the design gives the role
 * (design/ehr-target src/catalog.ts permissions()), counted and listed from the in-memory sample records, so creating a
 * sample record shows here. Nothing is read from Health ID.
 */
const ROLE_MODULES: Record<DemoRole, readonly string[]> = {
  'Platform Super Admin': [],
  'Hospital Owner': ['billing', 'insurance', 'ambulance', 'shifts', 'hr', 'quality', 'procurement'],
  'Medical Director': ['patients', 'appointments', 'journey', 'consult', 'lab', 'radiology', 'referrals', 'quality'],
  'Hospital Admin': ['shifts', 'hr', 'quality', 'services', 'ward-config', 'inventory', 'procurement'],
  Consultant: ['patients', 'appointments', 'journey', 'triage', 'consult', 'lab', 'referrals'],
  Doctor: ['patients', 'appointments', 'journey', 'triage', 'consult', 'lab', 'referrals'],
  Nurse: ['patients', 'triage', 'nursing', 'nursing-tasks', 'inpatient', 'wards'],
  Receptionist: ['patients', 'appointments', 'journey'],
  'Records Officer': ['patients'],
  'Lab Manager': ['lab', 'bloodbank', 'inventory', 'procurement'],
  'Lab Scientist': ['lab', 'bloodbank', 'inventory'],
  'Pharmacy Manager': ['pharmacy', 'inventory', 'procurement'],
  Pharmacist: ['pharmacy', 'inventory'],
  'Billing Officer': ['billing', 'insurance', 'policies'],
  Cashier: ['billing', 'insurance'],
  'Radiology Reporter': ['radiology'],
}

export function RoleDashboard({ role }: { readonly role: DemoRole }) {
  useSyncExternalStore(subscribeSamples, sampleVersion, sampleVersion)
  const { view } = useRoleView()
  // Sample records link only into sample pages: a live page with the module's address would not find them.
  const hrefOf = useSampleHref()
  const review = hrefOf('platform')
  const [period, setPeriod] = useState('7')
  const modules = ROLE_MODULES[role].map(id => sampleModule(id)).filter(module => module !== undefined)
  const attention = modules.flatMap(module => sampleRecords(module.id).slice(0, 1)
    .map(record => ({ module, record, href: hrefOf(module.id) }))).slice(0, 7)
  const today = modules.slice(0, 2).flatMap(module => sampleRecords(module.id).map(record => ({ module, record }))).slice(0, 6)
  return <>
    <EhrPageHeading title={`Welcome, Demo ${role}`} description={`The ${role} dashboard, as the design shows it.`}
      back={<EhrBackButton label="Back to my dashboard" onClick={() => view(null)} />} />
    <EhrSampleBanner />
    <EhrField label="Reporting period" hint="Record creation dates · local time" className="hid-ehr-blue-narrow">
      <EhrSelect value={period} onChange={event => setPeriod(event.target.value)}>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
      </EhrSelect>
    </EhrField>
    {role === 'Platform Super Admin' ? (
      <EhrCard title="Facility review"><p>Facilities waiting for Health ID to check them.</p>
        {review ? <Link className="hid-ehr-blue-link" to={review}>Open Facility review →</Link> : null}</EhrCard>
    ) : (
      <div className="hid-ehr-blue-grid">
        <EhrCard title="Activity in period">
          <div className="hid-ehr-blue-stats">
            {modules.slice(0, 4).map(module => (
              <EhrStatCard key={module.id} label={`${module.title} created`} value={sampleRecords(module.id).length} detail="No comparison yet" />
            ))}
          </div>
        </EhrCard>
        <EhrCard title="Needs attention">
          <ul className="hid-ehr-blue-list">{attention.map(({ module, record, href }) => (
            <li key={record.id} className="hid-ehr-blue-list-item">
              {href ? <Link className="hid-ehr-blue-link" to={`${href}/${record.id}`}>{sampleTitle(record)}</Link> : <strong>{sampleTitle(record)}</strong>}
              <span className="hid-ehr-blue-muted">{module.title} · {statusWords(record.status)}</span>
            </li>
          ))}</ul>
        </EhrCard>
        <EhrCard title="Today">
          <ul className="hid-ehr-blue-list">{today.map(({ module, record }) => (
            <li key={record.id} className="hid-ehr-blue-list-item">
              <strong>{sampleTitle(record)}</strong>
              <span className="hid-ehr-blue-muted">{module.title} · {statusWords(record.status)}</span>
            </li>
          ))}</ul>
        </EhrCard>
      </div>
    )}
    <h2 className="hid-ehr-blue-section-title">Pinned shortcuts</h2>
    <ul className="hid-ehr-blue-shortcuts">
      {modules.slice(0, 4).map(module => {
        const href = hrefOf(module.id)
        return <li key={module.id}>{href ? <Link className="hid-ehr-button hid-ehr-button-secondary" to={href}>{module.title}</Link>
          : <span className="hid-ehr-blue-shortcut-text">{module.title}</span>}</li>
      })}
    </ul>
  </>
}
