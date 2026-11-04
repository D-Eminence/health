import type { ReactNode } from 'react'
import { EhrEmptyState } from '@hid/ui/ehr'
import { usesNovuBackend } from '../../../backendContract'
import { selfServiceReview, selfServiceType, type OrganizationType } from '../../../staff/staffAccess'
import { reviewPendingText } from '../../../staff/routes/ReviewBanner'
import { useDeptAccess } from '../parts/access'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptNotice } from '../parts/DeptNotice'
import type { Product } from '../../frame/product'
import { resolveStaffProductHostname } from '../../../productHostname'
import { demoFacilitySite } from '../../blueFacilities'
import { OnePersonLab } from './OnePersonLab'

/*
 * Facility profile (target admin/facility.png), read-only: the working facility as today's staff session reports it
 * (staff/api.ts Facility: its name and, at a facility that signed itself up, Health ID support's check and the
 * facility's type). Health ID has no read or write for the rest of the target's profile, so each of those fields says it
 * is not available, and nothing is saved. As the target draws it, the page ends with the verification banner and
 * "Verification history". The one request is the facility administrator's One-person lab switch (OnePersonLab.tsx),
 * for holders of organization.manage only.
 */

const NOT_AVAILABLE = 'Not recorded'

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

/**
 * The profile’s words for the place and the person in charge, by the product it describes (profileProduct): a hospital,
 * a laboratory, a pharmacy, or, on outreach. and migrate., a facility. Beds are a hospital's alone.
 */
export const PROFILE_WORDS: Readonly<Record<Product, { readonly place: string; readonly inCharge: string; readonly beds: boolean }>> = {
  ehr: { place: 'Hospital', inCharge: 'Medical Director', beds: true },
  lab: { place: 'Laboratory', inCharge: 'Lead scientist', beds: false },
  pharmacy: { place: 'Pharmacy', inCharge: 'Superintendent pharmacist', beds: false },
  outreach: { place: 'Facility', inCharge: 'Person in charge', beds: false },
  migrate: { place: 'Facility', inCharge: 'Person in charge', beds: false },
}

/**
 * Which product's words the profile uses. It describes the facility, so it never goes by the signed-in person's own
 * permissions: a lab scientist at a hospital still works at a hospital. A product site's address (lab., pharmacy.,
 * outreach., migrate.) is that product. On ehr. and elsewhere, a facility reported as a laboratory or a pharmacy (a
 * facility that signed itself up) or one of the demo laboratory and pharmacy is that; any other facility is a hospital.
 */
export function profileProduct(hostname: string, facility: { readonly id: string; readonly type: OrganizationType | null }): Product {
  const site = resolveStaffProductHostname(hostname)?.key
  if (site && site !== 'ehr') return site
  if (facility.type === 'laboratory') return 'lab'
  if (facility.type === 'pharmacy') return 'pharmacy'
  const demo = demoFacilitySite(facility.id)
  return demo === 'lab' || demo === 'pharmacy' ? demo : 'ehr'
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
  const words = PROFILE_WORDS[profileProduct(window.location.hostname, { id: facility.id, type })]
  const place = words.place

  return (
    <DeptPage title="Facility profile" className="hid-ehr-dept-facility">
      <DeptSection title={`${place} details & picture`}>
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
          <dl><Field label={`${place} profile picture or logo`} /></dl>
        </div>
        <Fields>
          <Field label={`${place} name`} value={facility.name} />
          <Field label={`${place} phone`} />
          <Field label={`${place} email`} />
          <Field label={`${place} address`} full tall />
        </Fields>
        <h3>Operations & regulatory details</h3>
        <p>Verification: {reviewWords(review)}.</p>
        <Fields>
          <Field label="Operating hours" />
          {words.beds ? <Field label="Bed count" /> : null}
          <Field label="Departments" tall />
          <Field label="Services offered" full tall />
          <Field label="Facility licence number" />
          <Field label="CAC registration number" />
          <Field label="Facility registry ID" />
          <Field label={words.inCharge} />
        </Fields>
        <h3>Profile change history</h3>
        <p className="hid-ehr-dept-muted">{NOT_AVAILABLE}.</p>
      </DeptSection>
      <Verification name={facility.name} review={review} type={type} />
      <OnePersonLab key={facility.id} facilityId={facility.id} permissions={facility.permissions} />
      <DeptSection title="Verification history">
        <p className="hid-ehr-dept-muted">{NOT_AVAILABLE}.</p>
      </DeptSection>
    </DeptPage>
  )
}
