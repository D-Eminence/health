import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  EhrBadge, EhrButton, EhrCard, EhrField, EhrInput, EhrPageHeading, EhrSampleBanner, EhrSelect, EhrTextarea, type EhrBadgeTone,
} from '@hid/ui/ehr'
import { SAMPLE_DEPARTMENTS } from '../sample/store'

/**
 * The design's administration pages that Health ID does not serve yet, drawn from screens/admin (platform, facility,
 * setup and reports .png) and the prototype's own screens: samples, with fictional data held in component state only.
 * A reload starts again. Nothing is uploaded, written to a file or downloaded: the design's logo upload and Export
 * report are left out.
 */

const MISSING = 'Complete this field.'

/** A label with the design's required mark: a star, hidden from screen readers (the control says it is required). */
function required(label: string): ReactNode {
  return <>{label}<span aria-hidden="true"> *</span></>
}

/** The fields a form left empty, by key. */
function missing<T extends Record<string, string>>(values: T, keys: readonly (keyof T)[]): Partial<Record<keyof T, string>> {
  return Object.fromEntries(keys.filter(key => !values[key]?.trim()).map(key => [key, MISSING])) as Partial<Record<keyof T, string>>
}

function Facts({ facts }: { readonly facts: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="hid-ehr-blue-facts">
      {facts.map(([term, value]) => <div key={term} className="hid-ehr-blue-fact"><dt>{term}</dt><dd>{value}</dd></div>)}
    </dl>
  )
}

// --- Facility review (screens/admin/platform.png) --------------------------------------------------------------------

const REVIEW_OUTCOMES = ['Pending review', 'Verified', 'Rejected'] as const
type ReviewOutcome = typeof REVIEW_OUTCOMES[number]
const REVIEW_TONE: Record<ReviewOutcome | 'Not submitted', EhrBadgeTone> = {
  'Not submitted': 'brand', 'Pending review': 'brand', Verified: 'positive', Rejected: 'critical',
}

const REVIEW_FACILITIES = [
  { name: 'Fictional Cedar Hospital', address: '1 Example Road', email: 'hospital@example.test' },
  { name: 'Fictional Partner Clinic', address: '1 Example Road', email: 'hospital@example.test' },
] as const

function FacilityReviewCard({ facility }: { readonly facility: typeof REVIEW_FACILITIES[number] }) {
  const [status, setStatus] = useState<ReviewOutcome | 'Not submitted'>('Not submitted')
  const [form, setForm] = useState({ outcome: '', reason: '' })
  const [problems, setProblems] = useState<Partial<Record<'outcome' | 'reason', string>>>({})
  const [saved, setSaved] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = missing(form, ['outcome', 'reason'])
    setProblems(found)
    setSaved(false)
    if (Object.keys(found).length > 0) return
    setStatus(form.outcome as ReviewOutcome)
    setForm({ outcome: '', reason: '' })
    setSaved(true)
  }
  return (
    <EhrCard title={facility.name}>
      <EhrBadge tone={REVIEW_TONE[status]}>{status}</EhrBadge>
      <Facts facts={[['Registration', 'Not provided'], ['Address', facility.address], ['Email', facility.email]]} />
      <form noValidate onSubmit={submit} aria-label={`Review ${facility.name}`} className="hid-ehr-blue-stack">
        <EhrField label={required('Review outcome')} error={problems.outcome} className="hid-ehr-blue-half">
          <EhrSelect value={form.outcome} required onChange={event => setForm({ ...form, outcome: event.target.value })}>
            <option value="">Select…</option>
            {REVIEW_OUTCOMES.map(outcome => <option key={outcome}>{outcome}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label={required('Review reason')} error={problems.reason}>
          <EhrTextarea value={form.reason} required rows={3} onChange={event => setForm({ ...form, reason: event.target.value })} />
        </EhrField>
        <div><EhrButton type="submit">Save review</EhrButton></div>
        {saved ? <p role="status" className="hid-ehr-blue-muted">Review saved in this sample: {status}.</p> : null}
      </form>
    </EhrCard>
  )
}

export function PlatformReviewSample() {
  return <>
    <EhrPageHeading eyebrow="Platform administration" title="Facility review" />
    <EhrSampleBanner />
    <p className="hid-ehr-blue-flush">Fictional review of registered hospitals. These decisions do not constitute independent verification.</p>
    <div className="hid-ehr-blue-stack">
      {REVIEW_FACILITIES.map(facility => <FacilityReviewCard key={facility.name} facility={facility} />)}
    </div>
  </>
}

// --- Facility profile (screens/admin/facility.png) -------------------------------------------------------------------

function PresencePolicy() {
  const [policy, setPolicy] = useState({ enabled: true, offline: true, away: '5', critical: true })
  const [saved, setSaved] = useState(false)
  const check = (key: 'enabled' | 'offline' | 'critical', label: string) => (
    <label className="hid-ehr-blue-check">
      {label}
      <input type="checkbox" className="hid-ehr-blue-check-input" checked={policy[key]}
        onChange={event => { setSaved(false); setPolicy({ ...policy, [key]: event.target.checked }) }} />
    </label>
  )
  return (
    <EhrCard title="Facility presence policy" titleLevel={3}>
      <form noValidate className="hid-ehr-blue-form-grid" aria-label="Facility presence policy"
        onSubmit={event => { event.preventDefault(); setSaved(true) }}>
        <div className="hid-ehr-blue-stack">
          {check('enabled', 'Enable facility presence')}
          <EhrField label="Away after inactivity (minutes)">
            <EhrInput type="number" min={1} value={policy.away} onChange={event => { setSaved(false); setPolicy({ ...policy, away: event.target.value }) }} />
          </EhrField>
        </div>
        <div className="hid-ehr-blue-stack">
          {check('offline', 'Allow staff to appear offline')}
          {check('critical', 'Critical alert sounds bypass DND and quiet hours')}
        </div>
        <div className="hid-ehr-blue-full"><EhrButton type="submit">Save presence policy</EhrButton></div>
        {saved ? <p role="status" className="hid-ehr-blue-muted hid-ehr-blue-full">Presence policy saved in this sample.</p> : null}
      </form>
    </EhrCard>
  )
}

const HOSPITAL_FIELDS = { name: 'Hospital name', phone: 'Hospital phone', email: 'Hospital email', address: 'Hospital address' } as const
const OPERATIONS_FIELDS = {
  hours: 'Operating hours', beds: 'Bed count', services: 'Services offered', licence: 'Facility licence number',
  cac: 'CAC registration number', registryId: 'Facility registry ID', director: 'Medical Director',
} as const

export function FacilityProfileSample() {
  const [hospital, setHospital] = useState({ name: 'Fictional Cedar Hospital', phone: '08000000000', email: 'hospital@example.test', address: '1 Example Road' })
  const [problems, setProblems] = useState<Partial<Record<keyof typeof HOSPITAL_FIELDS, string>>>({})
  const [operations, setOperations] = useState({ hours: '', beds: '0', services: '', licence: '', cac: '', registryId: '', director: '' })
  const [departments, setDepartments] = useState<readonly string[]>(['General Outpatient', 'Emergency', 'Inpatient', 'Laboratory', 'Pharmacy'])
  const [history, setHistory] = useState<readonly { readonly at: string; readonly fields: string }[]>([])
  const record = (fields: readonly string[]) => setHistory(current => [
    { at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), fields: fields.join(', ') }, ...current,
  ])
  const saveHospital = (event: FormEvent) => {
    event.preventDefault()
    const found: Partial<Record<keyof typeof HOSPITAL_FIELDS, string>> = missing(hospital, ['name', 'phone', 'email', 'address'])
    if (!found.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hospital.email.trim())) found.email = 'Enter an email address like name@example.com.'
    setProblems(found)
    if (Object.keys(found).length === 0) record(Object.values(HOSPITAL_FIELDS))
  }
  const operation = (key: keyof typeof OPERATIONS_FIELDS, type = 'text') => (
    <EhrField label={OPERATIONS_FIELDS[key]}>
      <EhrInput type={type} min={type === 'number' ? 0 : undefined} value={operations[key]}
        onChange={event => setOperations({ ...operations, [key]: event.target.value })} />
    </EhrField>
  )
  // As the design does: the first letters of the name's first two words ("FC").
  const initials = hospital.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]!.toUpperCase()).join('') || 'H'
  return <>
    <EhrPageHeading title="Facility profile" />
    <EhrSampleBanner />
    <EhrCard title="Hospital details & picture">
      <div className="hid-ehr-blue-stack">
        <PresencePolicy />
        <div className="hid-ehr-blue-picture">
          <span className="hid-ehr-blue-initials" aria-hidden="true">{initials}</span>
          <p className="hid-ehr-blue-muted">The hospital picture or logo is not uploaded in the sample: the initials stand in for it.</p>
        </div>
        <form noValidate onSubmit={saveHospital} aria-label="Hospital details" className="hid-ehr-blue-form-grid">
          {(['name', 'phone', 'email'] as const).map(key => (
            <EhrField key={key} label={required(HOSPITAL_FIELDS[key])} error={problems[key]}>
              <EhrInput type={key === 'phone' ? 'tel' : key === 'email' ? 'email' : 'text'} required value={hospital[key]}
                onChange={event => setHospital({ ...hospital, [key]: event.target.value })} />
            </EhrField>
          ))}
          <EhrField label={required(HOSPITAL_FIELDS.address)} error={problems.address} className="hid-ehr-blue-full">
            <EhrTextarea required rows={3} value={hospital.address} onChange={event => setHospital({ ...hospital, address: event.target.value })} />
          </EhrField>
          <div className="hid-ehr-blue-full"><EhrButton type="submit">Save hospital details</EhrButton></div>
        </form>
        <form noValidate aria-labelledby="hid-ehr-blue-operations" className="hid-ehr-blue-form-grid"
          onSubmit={event => { event.preventDefault(); record(['Operations & regulatory details']) }}>
          <div className="hid-ehr-blue-full">
            <h3 id="hid-ehr-blue-operations" className="hid-ehr-blue-subheading">Operations & regulatory details</h3>
            <p className="hid-ehr-blue-flush">Verification: Not submitted. Changes to licence, CAC, registry ID or Medical Director require re-verification.</p>
          </div>
          {operation('hours')}
          {operation('beds', 'number')}
          <EhrField label="Departments" hint="Hold Ctrl (Cmd on a Mac) to choose more than one.">
            <EhrSelect multiple className="hid-ehr-blue-multi" value={[...departments]}
              onChange={event => setDepartments(Array.from(event.target.selectedOptions, option => option.value))}>
              {SAMPLE_DEPARTMENTS.map(department => <option key={department}>{department}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrField label={OPERATIONS_FIELDS.services} className="hid-ehr-blue-full">
            <EhrTextarea rows={3} value={operations.services} onChange={event => setOperations({ ...operations, services: event.target.value })} />
          </EhrField>
          {operation('licence')}
          {operation('cac')}
          {operation('registryId')}
          {operation('director')}
          <div className="hid-ehr-blue-full"><EhrButton type="submit">Save operations and regulatory details</EhrButton></div>
        </form>
        <section aria-labelledby="hid-ehr-blue-profile-history">
          <h3 id="hid-ehr-blue-profile-history" className="hid-ehr-blue-subheading">Profile change history</h3>
          {history.map((entry, index) => <p key={index} className="hid-ehr-blue-flush">{entry.at} · You · {entry.fields}</p>)}
          <p className="hid-ehr-blue-flush">Clinical roles, branch settings and verification decisions are managed separately.</p>
        </section>
      </div>
    </EhrCard>
    <div className="hid-ehr-blue-callout">
      <strong>Facility verification · Not submitted</strong>
      <p>Existing demonstration facility. Registration review has not been submitted.</p>
    </div>
    <EhrCard title="Verification history">
      <p className="hid-ehr-blue-muted">No reviews yet.</p>
    </EhrCard>
  </>
}

// --- Facility settings (screens/admin/setup.png: the setup steps, open at Launch) -------------------------------------

const SETUP_STEPS = ['Facility', 'Type', 'Departments', 'Branches', 'Staff', 'Roles', 'Billing', 'Review', 'Launch'] as const
const FACILITY_TYPES = ['Clinic', 'Specialist Clinic', 'Diagnostic Centre', 'Maternity Centre', 'Community Hospital',
  'Specialist Hospital', 'Multi-Branch Hospital', 'Teaching Hospital'] as const
const SETUP_ROLES = ['Hospital Owner', 'Medical Director', 'Hospital Admin', 'Consultant', 'Doctor', 'Nurse', 'Receptionist',
  'Records Officer', 'Lab Manager', 'Lab Scientist', 'Pharmacy Manager', 'Pharmacist', 'Billing Officer', 'Cashier', 'Radiology Reporter'] as const

/** The design's line under each department (design/ehr-target src/admin.tsx). */
function departmentLine(department: string): string {
  if (department === 'Laboratory') return 'Orders, samples and results; invite lab staff.'
  if (department === 'Pharmacy') return 'Prescription fulfilment; configure stock and pharmacy staff.'
  if (department === 'Inpatient' || department === 'ICU') return 'Admissions and nursing; configure wards and beds.'
  if (department === 'Radiology') return 'Studies and reports; assign radiology reporting permission.'
  return 'Appointments, triage, care records and department-specific context.'
}

export function FacilitySetupSample() {
  const navigate = useNavigate()
  const [step, setStep] = useState(SETUP_STEPS.length - 1)
  const [facility, setFacility] = useState({ name: 'Fictional Cedar Hospital', phone: '08000000000', email: 'hospital@example.test',
    address: '1 Example Road', city: 'Fictional City', state: 'Fictional State', registration: '' })
  const [type, setType] = useState('Specialist Hospital')
  const [departments, setDepartments] = useState<readonly string[]>(['General Outpatient', 'Emergency', 'Inpatient', 'Laboratory', 'Pharmacy'])
  const [billing, setBilling] = useState({ currency: 'NGN', prefix: 'DEMO-', methods: 'Cash, Transfer, Card, Insurance', timing: 'After service', insurance: true })
  const [problem, setProblem] = useState('')
  const next = () => { setProblem(''); setStep(current => Math.min(SETUP_STEPS.length - 1, current + 1)) }
  const continueWith = (event: FormEvent) => { event.preventDefault(); next() }
  const text = (key: keyof typeof facility, label: string, type = 'text') => (
    <EhrField label={label}>
      <EhrInput type={type} value={facility[key]} onChange={event => setFacility({ ...facility, [key]: event.target.value })} />
    </EhrField>
  )
  const steps: Record<typeof SETUP_STEPS[number], ReactNode> = {
    Facility: (
      <EhrCard>
        <form noValidate onSubmit={continueWith} aria-label="Facility" className="hid-ehr-blue-form-grid">
          {text('name', 'Hospital name')}
          {text('phone', 'Main phone', 'tel')}
          {text('email', 'Main email', 'email')}
          {text('address', 'Address')}
          {text('city', 'City')}
          {text('state', 'State')}
          {text('registration', 'Optional registration number')}
          <div className="hid-ehr-blue-full"><EhrButton type="submit">Save and continue</EhrButton></div>
        </form>
        <p className="hid-ehr-blue-flush">Hospital review: not submitted. Entering a registration number does not verify a hospital.</p>
      </EhrCard>
    ),
    Type: (
      <EhrCard>
        <form noValidate onSubmit={continueWith} aria-label="Type" className="hid-ehr-blue-stack">
          <EhrField label={required('Facility type')} className="hid-ehr-blue-half">
            <EhrSelect value={type} required onChange={event => setType(event.target.value)}>
              {FACILITY_TYPES.map(option => <option key={option}>{option}</option>)}
            </EhrSelect>
          </EhrField>
          <div><EhrButton type="submit">Save and continue</EhrButton></div>
        </form>
        <p className="hid-ehr-blue-flush">Types suggest defaults. Clinical specialties share the appointments, triage and consultation infrastructure.
          Multi-Branch Hospital requires at least two configured branches.</p>
      </EhrCard>
    ),
    Departments: (
      <EhrCard title="Enabled departments">
        <div className="hid-ehr-blue-department-grid">
          {SAMPLE_DEPARTMENTS.map(department => (
            <label key={department} className="hid-ehr-blue-department">
              <input type="checkbox" className="hid-ehr-blue-check-input" checked={departments.includes(department)}
                onChange={() => setDepartments(departments.includes(department) ? departments.filter(item => item !== department) : [...departments, department])} />
              <strong>{department}</strong>
              <small>{departmentLine(department)}</small>
            </label>
          ))}
        </div>
        {problem ? <p role="alert" className="hid-ehr-error">{problem}</p> : null}
        <EhrButton onClick={() => departments.length === 0 ? setProblem('Select at least one department.') : next()}>Save and continue</EhrButton>
      </EhrCard>
    ),
    Branches: (
      <EhrCard title="Branches">
        <p className="hid-ehr-blue-flush">Main branch · {facility.address} · {departments.join(', ')}</p>
        <EhrButton onClick={next}>Continue to staff</EhrButton>
      </EhrCard>
    ),
    Staff: (
      <EhrCard title="Staff">
        <p className="hid-ehr-blue-flush">Reporting hierarchies are optional. Shifts can be configured now or after launch.</p>
        <EhrButton onClick={next}>Continue to roles</EhrButton>
      </EhrCard>
    ),
    Roles: (
      <EhrCard title="Role templates and permission scopes">
        <p className="hid-ehr-blue-flush">Administrative ownership never grants clinical signing, prescribing or dispensing rights. Branch access and
          restrictions are editable in Staff & access.</p>
        <ul className="hid-ehr-blue-tags">{SETUP_ROLES.map(role => <li key={role}>{role}</li>)}</ul>
        <EhrButton onClick={next}>Continue to billing</EhrButton>
      </EhrCard>
    ),
    Billing: (
      <EhrCard>
        <form noValidate onSubmit={continueWith} aria-label="Billing" className="hid-ehr-blue-form-grid">
          <EhrField label="Currency"><EhrInput value={billing.currency} onChange={event => setBilling({ ...billing, currency: event.target.value })} /></EhrField>
          <EhrField label="Invoice numbering prefix"><EhrInput value={billing.prefix} onChange={event => setBilling({ ...billing, prefix: event.target.value })} /></EhrField>
          <EhrField label="Accepted payment methods"><EhrInput value={billing.methods} onChange={event => setBilling({ ...billing, methods: event.target.value })} /></EhrField>
          <EhrField label={required('Payment policy')}>
            <EhrSelect value={billing.timing} required onChange={event => setBilling({ ...billing, timing: event.target.value })}>
              <option>Before service</option>
              <option>After service</option>
            </EhrSelect>
          </EhrField>
          <label className="hid-ehr-blue-check hid-ehr-blue-full">
            <input type="checkbox" className="hid-ehr-blue-check-input" checked={billing.insurance}
              onChange={event => setBilling({ ...billing, insurance: event.target.checked })} />
            Enable insurance support
          </label>
          <div className="hid-ehr-blue-full"><EhrButton type="submit">Save and continue</EhrButton></div>
        </form>
        <p className="hid-ehr-blue-flush">This configures patient service billing, not a platform subscription. Service pricing is optional before launch.</p>
      </EhrCard>
    ),
    Review: (
      <EhrCard title="Review your configuration">
        <Facts facts={[
          ['Name', facility.name], ['Type', type], ['Phone', facility.phone], ['Email', facility.email], ['Address', facility.address],
          ['City', facility.city], ['State', facility.state], ['Departments', departments.join(', ')], ['Currency', billing.currency],
          ['Payment methods', billing.methods], ['Payment timing', billing.timing], ['Insurance', billing.insurance ? 'Yes' : 'No'],
        ]} />
        <p className="hid-ehr-blue-flush">Optional after launch: staff invitations, service pricing, wards and beds, inventory and professional credential
          records.</p>
        <EhrButton onClick={next}>Review launch requirements</EhrButton>
      </EhrCard>
    ),
    Launch: (
      <EhrCard title="Hospital is launched">
        <p className="hid-ehr-blue-flush">A new hospital starts with no patients, stock or transactions. Sample loading is a separate explicit development
          action.</p>
        <div><Link className="hid-ehr-button" to="/provider">Open dashboard</Link></div>
      </EhrCard>
    ),
  }
  const current = SETUP_STEPS[step]!
  return <>
    <EhrPageHeading eyebrow={`Step ${step + 1} of ${SETUP_STEPS.length} · ${current}`} title="Facility settings"
      primaryAction={<EhrButton variant="secondary" onClick={() => navigate('/provider')}>Save and exit</EhrButton>} />
    <EhrSampleBanner />
    <nav className="hid-ehr-blue-stepper" aria-label="Setup steps">
      {SETUP_STEPS.map((name, index) => (
        <EhrButton key={name} variant="secondary" size="sm" aria-current={index === step ? 'step' : undefined}
          onClick={() => { setProblem(''); setStep(index) }}>{index + 1}. {name}</EhrButton>
      ))}
    </nav>
    <div className="hid-ehr-blue-stack">
      {steps[current]}
      {step > 0 ? <div><EhrButton variant="secondary" onClick={() => { setProblem(''); setStep(step - 1) }}>Back</EhrButton></div> : null}
    </div>
  </>
}

// --- Reports & Analytics (screens/admin/reports.png) ------------------------------------------------------------------

/** The day the sample records were made (sample/store.ts sampleTime): a range without it selects none of them. */
const SAMPLE_DAY = '2026-10-29'
const REPORT = [
  ['Visits', 6], ['Signed Encounters', 2], ['Admissions', 3], ['Occupied Beds', 2], ['Total Beds', 2], ['Published Results', 2],
  ['Fulfilled Prescriptions', 0], ['Invoiced', 30000], ['Collected', 4000], ['Outstanding', 26000], ['Stock Movements', 2],
] as const

export function ReportsSample() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const valid = !from || !to || from <= to
  const selected = (!from || from <= SAMPLE_DAY) && (!to || SAMPLE_DAY <= to)
  return <>
    <EhrPageHeading title="Reports & Analytics" />
    <EhrSampleBanner />
    <EhrCard>
      <div className="hid-ehr-blue-form-grid">
        <EhrField label="Created from"><EhrInput type="date" value={from} onChange={event => setFrom(event.target.value)} /></EhrField>
        <EhrField label="Created through"><EhrInput type="date" value={to} onChange={event => setTo(event.target.value)} /></EhrField>
      </div>
      <p className="hid-ehr-blue-flush">Scope: current hospital and branch. Date range selects records by creation date. Invoice collection includes
        payments and refunds against those invoices. Occupancy is occupied beds / total selected beds. Open queue time is elapsed minutes since entry.</p>
      {valid ? (
        <Facts facts={[
          ...REPORT.map(([label, value]) => [label, String(selected ? value : 0)] as const),
          ['Quality Rates', 'No data — no validated denominator'],
          ['Mean Open Queue Minutes', selected ? '7' : '0'],
        ]} />
      ) : <p role="alert" className="hid-ehr-error">Start date must precede end date.</p>}
    </EhrCard>
  </>
}
