import type { ReactNode } from 'react'
import { EhrEmptyState } from '@hid/ui/ehr'
import { usesNovuBackend } from '../../../backendContract'
import { roleLabels, selfServiceReview, selfServiceType, type OrganizationType } from '../../../staff/staffAccess'
import { reviewPendingText } from '../../../staff/routes/ReviewBanner'
import { useDeptAccess } from '../parts/access'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptFacts } from '../parts/DeptRecord'
import { countText } from '../parts/format'

/*
 * Facility profile (target admin/facility.png), read-only: the working facility as today's staff session reports it
 * (staff/api.ts Facility: name, code, the member's roles and permissions there, whether it is their primary facility,
 * and, at a facility that signed itself up, Health ID support's check and the facility's type). Health ID has no read or
 * write for the rest of the target's profile, so each of those fields says it is not available, and nothing is saved.
 * No request is made.
 */

const NOT_AVAILABLE = 'Not recorded'

/** The kinds of facility that sign themselves up, as the provider sign-up names them (ProviderEnrollment.tsx). */
const ORGANIZATION_TYPES: Readonly<Record<OrganizationType, string>> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  laboratory: 'Laboratory',
  pharmacy: 'Pharmacy',
  other: 'Other healthcare provider',
}

/** The picture's stand-in, as the target draws it: the first letters of the facility's first two words. */
function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word.charAt(0)).join('').toUpperCase()
}

/** One of the target's form fields, read-only: its label over its value, or that Health ID does not hold it. */
function Field({ label, value, full = false, tall = false }: {
  readonly label: string
  readonly value?: string
  readonly full?: boolean
  readonly tall?: boolean
}) {
  return (
    <div className={full ? 'hid-ehr-dept-full' : undefined}>
      <dt className="hid-ehr-label">{label}</dt>
      <dd className={['hid-ehr-dept-facility-value', tall && 'hid-ehr-dept-facility-tall'].filter(Boolean).join(' ')}>
        {value ?? <span className="hid-ehr-dept-facility-missing">{NOT_AVAILABLE}</span>}
      </dd>
    </div>
  )
}

function Fields({ children }: { readonly children: ReactNode }) {
  return <dl className="hid-ehr-dept-form-grid hid-ehr-dept-facility-fields">{children}</dl>
}

type Review = 'pending' | 'reviewed' | null

/** The check's state in the target's words. */
function reviewWords(review: Review): string {
  return review === 'pending' ? 'pending verification' : review === 'reviewed' ? 'verified' : 'not reported'
}

/**
 * The "Facility verification" banner, from Health ID support's check of a facility that signed itself up (Novu, P4b),
 * with today's words for each state (ReviewBanner.tsx: the pending banner and the Overview's "Facility check" card).
 */
function Verification({ name, review, type }: { readonly name: string; readonly review: Review; readonly type: OrganizationType | null }) {
  const text = review === 'pending'
    ? type ? reviewPendingText(name, type) : `Health ID support is checking ${name}. This usually takes up to one working day.`
    : review === 'reviewed' ? `Health ID support has checked ${name}, and it now has full access.`
      : 'Health ID reports verification only for a facility that signed itself up.'
  return (
    <DeptNotice tone={review === 'pending' ? 'caution' : 'info'} role="status" title={`Facility verification: ${reviewWords(review)}`}>
      <p>{text}</p>
    </DeptNotice>
  )
}

export function FacilityProfile() {
  const { facility } = useDeptAccess()
  if (!facility) {
    return (
      <DeptPage title="Facility profile" className="hid-ehr-dept-facility">
        <DeptSection>
          <EhrEmptyState title="No facility selected" message="Choose the facility you are working at to see its profile." />
        </DeptSection>
      </DeptPage>
    )
  }
  const novu = usesNovuBackend()
  const review: Review = novu ? selfServiceReview(facility) : null
  const type = novu ? selfServiceType(facility) : null
  const roles = roleLabels(facility.roles) || 'Staff'
  const permissions = facility.permissions

  return (
    <DeptPage title="Facility profile" className="hid-ehr-dept-facility">
      <DeptSection title="Hospital details & picture">
        <p className="hid-ehr-dept-facility-intro">This profile is read-only.</p>
        <div className="hid-ehr-dept-facility-inner">
          <h3>Facility presence policy</h3>
          <Fields>
            <Field label="Enable facility presence" />
            <Field label="Allow staff to appear offline" />
            <Field label="Away after inactivity (minutes)" />
            <Field label="Critical alert sounds bypass do not disturb and quiet hours" />
          </Fields>
        </div>
        <div className="hid-ehr-dept-facility-picture">
          <span className="hid-ehr-dept-facility-avatar" aria-hidden="true">{initials(facility.name)}</span>
          <dl><Field label="Hospital profile picture or logo" /></dl>
        </div>
        <Fields>
          <Field label="Hospital name" value={facility.name} />
          <Field label="Hospital phone" />
          <Field label="Hospital email" />
          <Field label="Hospital address" full tall />
        </Fields>
        <h3>Operations & regulatory details</h3>
        <p>Verification: {reviewWords(review)}.</p>
        <Fields>
          <Field label="Operating hours" />
          <Field label="Bed count" />
          <Field label="Departments" tall />
          <Field label="Services offered" full tall />
          <Field label="Facility licence number" />
          <Field label="CAC registration number" />
          <Field label="Facility registry ID" />
          <Field label="Medical Director" />
        </Fields>
        <h3>Profile change history</h3>
        <p className="hid-ehr-dept-muted">{NOT_AVAILABLE}.</p>
      </DeptSection>
      <Verification name={facility.name} review={review} type={type} />
      <DeptSection title="Facility details">
        <DeptFacts facts={[
          { label: 'Facility name', value: facility.name },
          { label: 'Facility type', value: type ? ORGANIZATION_TYPES[type] : 'Not reported' },
          { label: 'Facility code', value: facility.code?.trim() || 'Not reported' },
          { label: 'Your roles here', value: roles },
          { label: 'Your primary facility', value: facility.isPrimary ? 'Yes' : 'No' },
          { label: 'Your permissions here', value: permissions.length === 0 ? 'None' : (
            <details className="hid-ehr-dept-facility-permissions">
              <summary>{countText(permissions.length, 'permission')}</summary>
              <ul className="hid-ehr-dept-facility-codes">
                {permissions.map(code => <li key={code} className="hid-ehr-dept-mono">{code}</li>)}
              </ul>
            </details>
          ) },
        ]} />
      </DeptSection>
      <DeptSection title="Verification history">
        <p className="hid-ehr-dept-muted">{NOT_AVAILABLE}.</p>
      </DeptSection>
    </DeptPage>
  )
}
