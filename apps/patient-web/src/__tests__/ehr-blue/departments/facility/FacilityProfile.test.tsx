import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FacilityProfile } from '../../../../ehr-blue/departments/facility/FacilityProfile'
import { DEMO_HOSPITAL_ID, DEMO_LABORATORY_ID, DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * Facility profile in the blue EHR (target admin/facility.png), read-only: the working facility as the staff session
 * reports it (name, code, the member's roles and permissions there, primary, and Health ID support's check of a
 * facility that signed itself up), with every target field Health ID does not hold marked as such. It reads nothing.
 */
const session = vi.hoisted(() => ({ facility: undefined as unknown }))
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility as FakeFacility | undefined) }
})

// Any API member the page touches is recorded: it should touch none.
const api = vi.hoisted(() => {
  const touched: string[] = []
  const recorder = (name: string) => new Proxy({}, {
    get(_, key) {
      if (typeof key === 'string') touched.push(`${name}.${key}`)
      return () => Promise.reject(new Error('not expected'))
    },
  })
  return { touched, recorder }
})
vi.mock('../../../../staff/api', () => ({
  staffApi: api.recorder('staffApi'), facilityStaffApi: api.recorder('facilityStaffApi'), orderRoutesApi: api.recorder('orderRoutesApi'),
}))

const NOT_AVAILABLE = 'Not recorded'
const PERMISSIONS = ['audit.read', 'workforce.manage', 'identity.patient.read']
const HOSPITAL = fakeFacility(PERMISSIONS, { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', roles: ['org_admin'], code: 'DEMO-HOSP' })

/** A field's value: the dd after the dt that names it. */
function valueOf(label: string, root: HTMLElement = document.body): string {
  const term = within(root).getAllByText(label, { selector: 'dt' })
  expect(term).toHaveLength(1)
  return term[0]!.nextElementSibling?.textContent ?? ''
}
const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement
const verification = () => screen.getByRole('status')

beforeEach(() => {
  api.touched.length = 0
  session.facility = HOSPITAL
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('Facility profile: the target’s sections, read-only', () => {
  it('shows the facility’s name and marks every target field Health ID does not hold', () => {
    renderDept(<FacilityProfile />)

    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['Facility profile'])
    expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent))
      .toEqual(['Hospital details & picture', 'Facility details', 'Verification history'])
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Facility presence policy', 'Operations & regulatory details', 'Profile change history'])

    const details = section('Hospital details & picture')
    expect(within(details).getByText('This profile is read-only.')).toBeTruthy()
    expect(valueOf('Hospital name', details)).toBe('Demo Hospital')
    for (const label of ['Enable facility presence', 'Allow staff to appear offline', 'Away after inactivity (minutes)',
      'Critical alert sounds bypass do not disturb and quiet hours', 'Hospital profile picture or logo', 'Hospital phone',
      'Hospital email', 'Hospital address', 'Operating hours', 'Bed count', 'Departments', 'Services offered',
      'Facility licence number', 'CAC registration number', 'Facility registry ID', 'Medical Director']) {
      expect(valueOf(label, details), label).toBe(NOT_AVAILABLE)
    }
    expect(within(details).getByText('Verification: not reported.')).toBeTruthy()
    expect(within(details).getByText(`${NOT_AVAILABLE}.`)).toBeTruthy()
    expect(within(section('Verification history')).getByText(`${NOT_AVAILABLE}.`)).toBeTruthy()

    // The picture's stand-in is the facility's initials, hidden from assistive technology.
    const avatar = within(details).getByText('DH')
    expect(avatar.getAttribute('aria-hidden')).toBe('true')

    // Nothing to fill in or save: no field, checkbox, upload or button.
    for (const role of ['textbox', 'checkbox', 'combobox', 'spinbutton', 'button', 'link'] as const) {
      expect(screen.queryAllByRole(role), role).toEqual([])
    }
    expect(document.querySelectorAll('input, select, textarea, [tabindex]')).toHaveLength(0)
    expect(api.touched).toEqual([])
  })

  it('lists the session’s facts about the facility and the member’s place in it', () => {
    renderDept(<FacilityProfile />)
    const facts = section('Facility details')

    expect(valueOf('Facility name', facts)).toBe('Demo Hospital')
    expect(valueOf('Facility type', facts)).toBe('Not reported')
    expect(valueOf('Facility code', facts)).toBe('DEMO-HOSP')
    // Health ID's words for the roles on either backend, never their codes (parity report 3.1 #16).
    expect(valueOf('Your roles here', facts)).toBe('Facility administrator')
    expect(valueOf('Your primary facility', facts)).toBe('Yes')

    const summary = within(facts).getByText('3 permissions')
    expect(summary.tagName).toBe('SUMMARY')
    const disclosure = summary.closest('details') as HTMLDetailsElement
    expect(disclosure.open).toBe(false)
    fireEvent.click(summary)
    expect(disclosure.open).toBe(true)
    expect(within(disclosure).getAllByRole('listitem').map(item => item.textContent)).toEqual(PERMISSIONS)
  })

  it('says when the facility has no code, no roles or no permissions, and is not the member’s primary facility', () => {
    session.facility = fakeFacility([], { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', roles: [], isPrimary: false })
    renderDept(<FacilityProfile />)
    const facts = section('Facility details')
    expect(valueOf('Facility code', facts)).toBe('Not reported')
    expect(valueOf('Your roles here', facts)).toBe('Staff')
    expect(valueOf('Your primary facility', facts)).toBe('No')
    expect(valueOf('Your permissions here', facts)).toBe('None')
  })

  // "porter" is a fictional code Health ID has no name for.
  it.each(['main-v1', 'novu-v1'])('reads "Staff" for a role Health ID has no name for on a %s build, never its code', contract => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    session.facility = fakeFacility([], { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', roles: ['porter'] })
    renderDept(<FacilityProfile />)
    expect(valueOf('Your roles here', section('Facility details'))).toBe('Staff')
    expect(document.body.textContent).not.toMatch(/\bporter\b/)
  })

  it('follows a switch of the working facility', () => {
    const { rerender } = renderDept(<FacilityProfile />)
    session.facility = fakeFacility(['lab.work-item.read'], { id: DEMO_LABORATORY_ID, name: 'Demo Laboratory', isPrimary: false })
    rerender(<MemoryRouter><div className="hid-ehr"><FacilityProfile /></div></MemoryRouter>)

    // The demo laboratory is a laboratory: the profile says laboratory, not hospital.
    expect(valueOf('Laboratory name', section('Laboratory details & picture'))).toBe('Demo Laboratory')
    expect(valueOf('Your primary facility', section('Facility details'))).toBe('No')
    expect(screen.getByText('DL')).toBeTruthy()
    expect(screen.queryByText('Demo Hospital')).toBeNull()
  })

  const OTHER_ID = '5a1e0000-0000-4000-8000-000000000009'
  it.each([
    { product: 'the demo laboratory', facility: { id: DEMO_LABORATORY_ID }, place: 'Laboratory', inCharge: 'Lead scientist' },
    { product: 'the demo pharmacy', facility: { id: DEMO_PHARMACY_ID }, place: 'Pharmacy', inCharge: 'Superintendent pharmacist' },
    { product: 'a laboratory that signed itself up', novu: true, place: 'Laboratory', inCharge: 'Lead scientist',
      facility: { id: OTHER_ID, selfService: { review: 'reviewed' as const, organizationType: 'laboratory' } } },
    { product: 'a pharmacy that signed itself up', novu: true, place: 'Pharmacy', inCharge: 'Superintendent pharmacist',
      facility: { id: OTHER_ID, selfService: { review: 'reviewed' as const, organizationType: 'pharmacy' } } },
    { product: 'any facility on lab.', hostname: 'lab.healthidentitydirectory.com', facility: { id: OTHER_ID },
      place: 'Laboratory', inCharge: 'Lead scientist' },
    { product: 'any facility on pharmacy.', hostname: 'pharmacy.staging.healthidentitydirectory.com', facility: { id: OTHER_ID },
      place: 'Pharmacy', inCharge: 'Superintendent pharmacist' },
  ])('speaks of $product as such, not a hospital, and asks no bed count there', ({ facility, novu, hostname, place, inCharge }) => {
    if (novu) vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    if (hostname) vi.stubGlobal('location', { ...window.location, hostname })
    try {
      session.facility = fakeFacility(['audit.read'], { name: 'Demo Place', ...facility })
      renderDept(<FacilityProfile />)
      const details = section(`${place} details & picture`)
      expect(valueOf(`${place} name`, details)).toBe('Demo Place')
      for (const label of [`${place} profile picture or logo`, `${place} phone`, `${place} email`, `${place} address`, inCharge]) {
        expect(valueOf(label, details), label).toBe(NOT_AVAILABLE)
      }
      expect(within(details).queryByText('Bed count')).toBeNull()
      expect(within(details).queryByText('Medical Director')).toBeNull()
      expect(details.textContent).not.toMatch(/Hospital/)
    } finally { vi.unstubAllGlobals() }
  })

  // The words describe the facility, not the person: a lab scientist or a pharmacist at a hospital still sees a hospital.
  it.each([
    ['a lab scientist', ['lab.work-item.read']],
    ['a pharmacist', ['pharmacy.work-item.read']],
  ])('speaks of a hospital to %s at a hospital on ehr.', (_who, permissions) => {
    vi.stubGlobal('location', { ...window.location, hostname: 'ehr.healthidentitydirectory.com' })
    try {
      session.facility = fakeFacility(permissions, { id: OTHER_ID, name: 'General Hospital' })
      renderDept(<FacilityProfile />)
      const details = section('Hospital details & picture')
      expect(valueOf('Hospital name', details)).toBe('General Hospital')
      expect(valueOf('Bed count', details)).toBe(NOT_AVAILABLE)
      expect(valueOf('Medical Director', details)).toBe(NOT_AVAILABLE)
      expect(details.textContent).not.toMatch(/Laboratory|Pharmacy/)
    } finally { vi.unstubAllGlobals() }
  })

  it('asks for a facility when the session has none', () => {
    session.facility = undefined
    renderDept(<FacilityProfile />)
    expect(screen.getByRole('heading', { level: 1, name: 'Facility profile' })).toBeTruthy()
    expect(screen.getByText('No facility selected')).toBeTruthy()
    expect(screen.getByText('Choose the facility you are working at to see its profile.')).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(api.touched).toEqual([])
  })
})

describe('Facility profile: the “Facility verification” banner', () => {
  it('says verification is not reported for a facility that did not sign itself up', () => {
    renderDept(<FacilityProfile />)
    expect(verification().textContent).toBe('Facility verification: not reported'
      + 'Health ID reports verification only for a facility that signed itself up.')
    expect(verification().className).toContain('hid-ehr-dept-notice-info')
  })

  it('ignores a review the main backend never sends, as today’s banner does', () => {
    session.facility = { ...HOSPITAL, selfService: { review: 'pending', organizationType: 'hospital' } }
    renderDept(<FacilityProfile />)
    expect(verification().textContent).toContain('Facility verification: not reported')
  })

  it('says what stays locked while Health ID support checks a facility that signed itself up (Novu)', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    session.facility = { ...HOSPITAL, selfService: { review: 'pending', organizationType: 'hospital' } }
    renderDept(<FacilityProfile />)

    expect(verification().textContent).toBe('Facility verification: pending verification'
      + 'Health ID support is checking Demo Hospital. This usually takes up to one working day. Until then, patient records, '
      + 'emergency access, the Laboratory and Pharmacy work lists and adding staff are locked. When the check is done you’ll be '
      + 'signed out once: sign in again to use them.')
    expect(verification().className).toContain('hid-ehr-dept-notice-caution')
    expect(screen.getByText('Verification: pending verification.')).toBeTruthy()
    const facts = section('Facility details')
    expect(valueOf('Facility type', facts)).toBe('Hospital')
    expect(valueOf('Your roles here', facts)).toBe('Facility administrator')
    // The staff page's licence check is ReviewBanner's own: this page reads nothing.
    expect(api.touched).toEqual([])
  })

  it('says only that the check is running when the facility’s type is not reported', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    session.facility = { ...HOSPITAL, selfService: { review: 'pending', organizationType: '' } }
    renderDept(<FacilityProfile />)
    expect(verification().textContent).toBe('Facility verification: pending verification'
      + 'Health ID support is checking Demo Hospital. This usually takes up to one working day.')
    expect(valueOf('Facility type', section('Facility details'))).toBe('Not reported')
  })

  it('says a facility Health ID support has checked has full access', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    session.facility = fakeFacility(['lab.work-item.read'], { id: DEMO_LABORATORY_ID, name: 'Demo Laboratory', roles: ['lab'],
      code: 'DEMO-LAB', selfService: { review: 'reviewed', organizationType: 'laboratory' } })
    renderDept(<FacilityProfile />)

    expect(verification().textContent).toBe('Facility verification: verified'
      + 'Health ID support has checked Demo Laboratory, and it now has full access.')
    expect(verification().className).toContain('hid-ehr-dept-notice-info')
    expect(screen.getByText('Verification: verified.')).toBeTruthy()
    const facts = section('Facility details')
    expect(valueOf('Facility type', facts)).toBe('Laboratory')
    expect(valueOf('Facility code', facts)).toBe('DEMO-LAB')
    expect(valueOf('Your roles here', facts)).toBe('Laboratory scientist')
  })

  it('names a type the portal does not know as another healthcare provider', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    session.facility = { ...HOSPITAL, selfService: { review: 'reviewed', organizationType: 'hospice' } }
    renderDept(<FacilityProfile />)
    expect(valueOf('Facility type', section('Facility details'))).toBe('Other healthcare provider')
  })
})
