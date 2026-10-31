import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FacilityProfile } from '../../../../ehr-blue/departments/facility/FacilityProfile'
import { reviewPendingText } from '../../../../staff/routes/ReviewBanner'
import { DEMO_HOSPITAL_ID, DEMO_LABORATORY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * Facility profile in the blue EHR (target admin/facility.png), read-only: the working facility as the staff session
 * reports it (its name, and Health ID support's check of a facility that signed itself up), with every target field
 * Health ID does not hold marked as such. As the target draws it, there is no "Facility details" card: the page ends
 * with the verification banner and "Verification history". It reads nothing.
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

const NOT_AVAILABLE = 'Not available in Health ID yet'
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
      .toEqual(['Hospital details & picture', 'Verification history'])
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Facility presence policy', 'Operations & regulatory details', 'Profile change history'])

    const details = section('Hospital details & picture')
    expect(within(details).getByText(`This profile is read-only. Details Health ID does not hold yet show “${NOT_AVAILABLE}”.`)).toBeTruthy()
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

  it('has no “Facility details” card: it ends with the verification banner and “Verification history”', () => {
    renderDept(<FacilityProfile />)

    expect(screen.queryByRole('heading', { name: 'Facility details' })).toBeNull()
    for (const label of ['Facility name', 'Facility type', 'Facility code', 'Your roles here', 'Your primary facility', 'Your permissions here']) {
      expect(screen.queryByText(label), label).toBeNull()
    }
    // Neither the code, the member's roles nor their permissions are listed anywhere on the page.
    expect(document.body.textContent).not.toContain('DEMO-HOSP')
    expect(document.body.textContent).not.toContain('org_admin')
    for (const code of PERMISSIONS) expect(document.body.textContent).not.toContain(code)
    expect(document.querySelectorAll('details, summary')).toHaveLength(0)

    // The page: its heading, then the details card, the banner and the history card, last.
    const page = document.querySelector('.hid-ehr-dept') as HTMLElement
    const [, details, banner, history, ...rest] = [...page.children]
    expect(rest).toEqual([])
    expect(details).toBe(section('Hospital details & picture'))
    expect(banner).toBe(verification())
    expect(history).toBe(section('Verification history'))
    expect(page.querySelectorAll('.hid-ehr-card')).toHaveLength(2)
  })

  it('follows a switch of the working facility', () => {
    const { rerender } = renderDept(<FacilityProfile />)
    session.facility = fakeFacility(['lab.work-item.read'], { id: DEMO_LABORATORY_ID, name: 'Demo Laboratory', isPrimary: false })
    rerender(<MemoryRouter><div className="hid-ehr"><FacilityProfile /></div></MemoryRouter>)

    expect(valueOf('Hospital name', section('Hospital details & picture'))).toBe('Demo Laboratory')
    expect(screen.getByText('DL')).toBeTruthy()
    expect(screen.queryByText('Demo Hospital')).toBeNull()
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
    expect(screen.queryByRole('heading', { name: 'Facility details' })).toBeNull()
    // The staff page's licence check is ReviewBanner's own: this page reads nothing.
    expect(api.touched).toEqual([])
  })

  it('says only that the check is running when the facility’s type is not reported', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    session.facility = { ...HOSPITAL, selfService: { review: 'pending', organizationType: '' } }
    renderDept(<FacilityProfile />)
    expect(verification().textContent).toBe('Facility verification: pending verification'
      + 'Health ID support is checking Demo Hospital. This usually takes up to one working day.')
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
    expect(screen.queryByText('DEMO-LAB')).toBeNull()
    expect(screen.queryByText('Laboratory scientist')).toBeNull()
  })

  it('words the pending check for a type the portal does not know as another healthcare provider’s', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    session.facility = { ...HOSPITAL, selfService: { review: 'pending', organizationType: 'hospice' } }
    renderDept(<FacilityProfile />)
    expect(verification().textContent).toBe(`Facility verification: pending verification${reviewPendingText('Demo Hospital', 'other')}`)
    expect(reviewPendingText('Demo Hospital', 'other')).not.toBe(reviewPendingText('Demo Hospital', 'hospital'))
  })
})
