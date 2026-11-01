import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter } from 'react-router-dom'
import { FacilityProfile } from '../../../../ehr-blue/departments/facility/FacilityProfile'
import { DEMO_HOSPITAL_ID, DEMO_LABORATORY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * Facility profile in the blue EHR (target admin/facility.png), read-only: the working facility as the staff session
 * reports it (name, code, the member's roles and permissions there, primary, and Health ID support's check of a
 * facility that signed itself up), with every target field Health ID does not hold marked as such. It reads nothing but
 * the facility agreement (proposed GET identity/facility-agreements/current), for its Agreement card.
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
// The Agreement card's own read (proposed): not served, unless a test says otherwise.
const agreement = vi.hoisted(() => ({ current: vi.fn(), record: vi.fn() }))
vi.mock('../../../../staff/api', () => ({
  staffApi: api.recorder('staffApi'), facilityStaffApi: api.recorder('facilityStaffApi'), orderRoutesApi: api.recorder('orderRoutesApi'),
  facilityAgreementApi: agreement,
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
  agreement.current.mockReset()
  agreement.current.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
  session.facility = HOSPITAL
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('Facility profile: the target’s sections, read-only', () => {
  it('shows the facility’s name and marks every target field Health ID does not hold', () => {
    renderDept(<FacilityProfile />)

    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['Facility profile'])
    expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent))
      .toEqual(['Hospital details & picture', 'Facility details', 'Agreement', 'Verification history'])
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

    // Nothing to fill in or save: no field, checkbox, upload or button, but Read for the facility agreement.
    for (const role of ['textbox', 'checkbox', 'combobox', 'spinbutton', 'link'] as const) {
      expect(screen.queryAllByRole(role), role).toEqual([])
    }
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Read'])
    expect(document.querySelectorAll('input, select, textarea, [tabindex]')).toHaveLength(0)
    expect(api.touched).toEqual([])
  })

  it('lists the session’s facts about the facility and the member’s place in it', () => {
    renderDept(<FacilityProfile />)
    const facts = section('Facility details')

    expect(valueOf('Facility name', facts)).toBe('Demo Hospital')
    expect(valueOf('Facility type', facts)).toBe('Not reported')
    expect(valueOf('Facility code', facts)).toBe('DEMO-HOSP')
    // Today's Overview card words the roles: codes as they are on main, Health ID's words on Novu.
    expect(valueOf('Your roles here', facts)).toBe('org_admin')
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

  it('follows a switch of the working facility', () => {
    const { rerender } = renderDept(<FacilityProfile />)
    session.facility = fakeFacility(['lab.work-item.read'], { id: DEMO_LABORATORY_ID, name: 'Demo Laboratory', isPrimary: false })
    rerender(<MemoryRouter><div className="hid-ehr"><FacilityProfile /></div></MemoryRouter>)

    expect(valueOf('Hospital name', section('Hospital details & picture'))).toBe('Demo Laboratory')
    expect(valueOf('Your primary facility', section('Facility details'))).toBe('No')
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

describe('Facility profile: the Agreement card', () => {
  it('shows who signed the facility agreement, when, and which version, with Read and Download copy', async () => {
    agreement.current.mockResolvedValue({ version: '1.0', signerName: 'Dr Amaka Eze', facilityName: 'Demo Hospital',
      signedAt: '2026-11-01T10:30:00.000Z', needsAgreement: false, changes: [] })
    renderDept(<FacilityProfile />)
    const card = section('Agreement')
    await waitFor(() => expect(valueOf('Signed by', card)).toBe('Dr Amaka Eze'))
    expect(agreement.current).toHaveBeenCalledWith(DEMO_HOSPITAL_ID)
    expect(valueOf('Date', card)).toBe('1 November 2026')
    expect(valueOf('Version', card)).toBe('1.0')
    expect(within(card).getAllByRole('button').map(button => button.textContent)).toEqual(['Read', 'Download copy'])
    fireEvent.click(within(card).getByRole('button', { name: 'Read' }))
    expect(screen.getByRole('dialog', { name: 'Health ID facility agreement' })).toBeTruthy()
  })

  it('offers Read alone, and says nothing about why, while the read answers 404', async () => {
    renderDept(<FacilityProfile />)
    await waitFor(() => expect(agreement.current).toHaveBeenCalledTimes(1))
    const card = section('Agreement')
    expect(within(card).getAllByRole('button').map(button => button.textContent)).toEqual(['Read'])
    expect(within(card).queryByText('Signed by')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
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
