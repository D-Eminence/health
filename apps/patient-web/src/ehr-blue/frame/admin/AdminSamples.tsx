import { useState } from 'react'
import {
  EhrBadge, EhrButton, EhrCard, EhrDataTable, EhrField, EhrInput, EhrPageHeading, EhrSampleBanner, EhrSelect, EhrStatCard,
} from '@hid/ui/ehr'

/**
 * The design's administration pages that Health ID does not serve yet (screens/admin): samples, with fictional data
 * held in component state only. A reload starts again.
 */

export function ReportsSample() {
  const [period, setPeriod] = useState('7')
  const scale = Number(period) / 7
  const figures = [
    { label: 'Patients registered', value: Math.round(12 * scale) },
    { label: 'Patient visits', value: Math.round(31 * scale) },
    { label: 'Lab tests released', value: Math.round(18 * scale) },
    { label: 'Prescriptions dispensed', value: Math.round(22 * scale) },
  ]
  return <>
    <EhrPageHeading title="Reports & Analytics" description="Activity at this facility over a period." />
    <EhrSampleBanner />
    <EhrField label="Reporting period" className="hid-ehr-blue-narrow">
      <EhrSelect value={period} onChange={event => setPeriod(event.target.value)}>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
      </EhrSelect>
    </EhrField>
    <div className="hid-ehr-blue-stats">
      {figures.map(figure => <EhrStatCard key={figure.label} label={figure.label} value={figure.value} detail="Fictional figure" />)}
    </div>
  </>
}

interface Review { readonly name: string; readonly type: string; readonly status: 'awaiting review' | 'approved' | 'returned' }

export function PlatformReviewSample() {
  const [reviews, setReviews] = useState<readonly Review[]>([
    { name: 'Fictional Cedar Hospital', type: 'Hospital', status: 'awaiting review' },
    { name: 'Fictional Palm Laboratory', type: 'Laboratory', status: 'awaiting review' },
    { name: 'Fictional Baobab Pharmacy', type: 'Pharmacy', status: 'approved' },
  ])
  const decide = (name: string, status: Review['status']) =>
    setReviews(current => current.map(review => review.name === name ? { ...review, status } : review))
  return <>
    <EhrPageHeading title="Facility review" description="Facilities that registered and wait for Health ID to check them." />
    <EhrSampleBanner />
    <EhrDataTable caption="Facilities to review (sample)" rows={reviews} rowKey={review => review.name} columns={[
      { id: 'name', header: 'Facility', cell: review => review.name },
      { id: 'type', header: 'Type', cell: review => review.type },
      { id: 'status', header: 'Status', cell: review => <EhrBadge tone={review.status === 'approved' ? 'positive' : review.status === 'returned' ? 'caution' : 'neutral'}>{review.status}</EhrBadge> },
      { id: 'act', header: <span className="hid-ehr-sr-only">Actions</span>, cell: review => review.status === 'awaiting review' ? (
        <span className="hid-ehr-actions">
          <EhrButton size="sm" onClick={() => decide(review.name, 'approved')}>Approve {review.name}</EhrButton>
          <EhrButton size="sm" variant="secondary" onClick={() => decide(review.name, 'returned')}>Return {review.name}</EhrButton>
        </span>
      ) : null },
    ]} />
  </>
}

export function FacilityProfileSample() {
  const [profile, setProfile] = useState({ name: 'Fictional Cedar Hospital', address: '1 Example Road, Fictional Town', phone: '0800 000 0000' })
  const [editing, setEditing] = useState(false)
  return <>
    <EhrPageHeading title="Facility profile" description="How the facility appears to patients and other facilities."
      primaryAction={editing ? undefined : <EhrButton variant="secondary" onClick={() => setEditing(true)}>Edit profile</EhrButton>} />
    <EhrSampleBanner />
    <EhrCard title="Facility details">
      {editing ? (
        <form noValidate onSubmit={event => { event.preventDefault(); setEditing(false) }} className="hid-ehr-blue-form-grid">
          <EhrField label="Facility name"><EhrInput value={profile.name} onChange={event => setProfile({ ...profile, name: event.target.value })} /></EhrField>
          <EhrField label="Address"><EhrInput value={profile.address} onChange={event => setProfile({ ...profile, address: event.target.value })} /></EhrField>
          <EhrField label="Phone"><EhrInput type="tel" value={profile.phone} onChange={event => setProfile({ ...profile, phone: event.target.value })} /></EhrField>
          <div className="hid-ehr-actions hid-ehr-blue-full"><EhrButton type="submit">Save sample profile</EhrButton></div>
        </form>
      ) : (
        <dl className="hid-ehr-blue-facts">
          <div className="hid-ehr-blue-fact"><dt>Facility name</dt><dd>{profile.name}</dd></div>
          <div className="hid-ehr-blue-fact"><dt>Address</dt><dd>{profile.address}</dd></div>
          <div className="hid-ehr-blue-fact"><dt>Phone</dt><dd>{profile.phone}</dd></div>
        </dl>
      )}
    </EhrCard>
  </>
}

const SETUP_STEPS = ['Facility', 'Type', 'Departments', 'Branches', 'Staff', 'Roles', 'Billing', 'Review', 'Launch'] as const

export function FacilitySetupSample() {
  const [done, setDone] = useState<readonly string[]>(['Facility', 'Type'])
  return <>
    <EhrPageHeading title="Facility settings" description="The setup steps, and what is still to do." />
    <EhrSampleBanner />
    <EhrCard title="Setup">
      <ol className="hid-ehr-blue-steps">
        {SETUP_STEPS.map((step, index) => (
          <li key={step} className="hid-ehr-blue-step">
            <span>{index + 1}. {step}</span>
            <EhrBadge tone={done.includes(step) ? 'positive' : 'neutral'}>{done.includes(step) ? 'Done' : 'To do'}</EhrBadge>
            {!done.includes(step) ? <EhrButton size="sm" variant="secondary" onClick={() => setDone([...done, step])}>Mark {step} done</EhrButton> : null}
          </li>
        ))}
      </ol>
    </EhrCard>
  </>
}
