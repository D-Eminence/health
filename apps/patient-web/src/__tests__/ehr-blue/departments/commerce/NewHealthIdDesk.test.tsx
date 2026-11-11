import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderDept } from '../harness'
import { NewHealthIdForm } from '../../../../ehr-blue/departments/pharmacy/newHealthId'

/*
 * A pharmacy's or laboratory's new Health ID sends the NIN check (`nin/resolve`), which needs the desk's contact for the
 * patient and whether they already have a Health ID (hid-system 0114, collect-fields-contract.md §3), as the
 * Registration page does. Every person and number here is fictional.
 */

vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return { useStaff: () => staffContext(fakeFacility(['identity.registration.write', 'identity.registration.approve'])) }
})

const api = vi.hoisted(() => ({
  registrationCapabilities: vi.fn(), resolveNin: vi.fn(), registrationCase: vi.fn(), approveNewRegistration: vi.fn(),
  linkExistingRegistration: vi.fn(), enrollRegistration: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const CASE = 'c0000000-0000-4000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  api.registrationCapabilities.mockResolvedValue({ nin: { enabled: true, state: 'test-only' }, newPatientRegistrationRequiresNin: true })
  api.resolveNin.mockResolvedValue({ caseId: CASE, status: 'pending_new_identity_approval', version: 1, candidateCount: 0 })
  api.registrationCase.mockResolvedValue({ caseId: CASE, status: 'pending_new_identity_approval', version: 1, candidateCount: 0 })
  api.approveNewRegistration.mockResolvedValue({ caseId: CASE, status: 'approved_new_identity', version: 2, candidateCount: 0,
    patient: { patientId: PATIENT, hid: 'HID-ZDEMAA' } })
  api.enrollRegistration.mockResolvedValue({ patientId: PATIENT, hid: 'HID-ZDEMAA', contactVerificationRequired: true, replayed: false })
})

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

async function openForm(onMade = vi.fn()) {
  renderDept(<NewHealthIdForm idBase="walk-in" facilityId="facility-demo" place="pharmacy" otcFallback={false} onMade={onMade} />)
  await screen.findByLabelText(/^First name/)
  type(/^First name/, 'Ada')
  type(/^Last name/, 'Example')
  type(/^Date of birth/, '1990-01-02')
  type(/^NIN/, '00000000000')
  type(/^Email/, 'ada@example.test')
  fireEvent.click(screen.getByRole('checkbox', { name: 'They agree to get a Health ID' }))
  return onMade
}

describe('a new Health ID at the pharmacy', () => {
  it('asks for the desk fields, and refuses a missing one in plain words before sending anything', async () => {
    await openForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create Health ID' }))
    expect(await screen.findAllByText('This field is required.')).not.toHaveLength(0)
    expect(screen.getByText('Choose the state.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Phone/))
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('sends the desk fields with the NIN check', async () => {
    const onMade = await openForm()
    type(/^Phone/, '0803 123 4567')
    type(/^Address/, '3 Example Street')
    type(/^City or town/, 'Ikeja')
    type(/^State/, 'LA')
    type(/^Local government area/, 'Ikeja')
    type(/^Does the patient already have a Health ID/, 'yes')
    type(/^Existing Health ID/, 'hid-abc234')
    fireEvent.click(screen.getByRole('button', { name: 'Create Health ID' }))
    await waitFor(() => expect(onMade).toHaveBeenCalled())
    expect(api.resolveNin.mock.calls[0]?.[1]).toEqual({ firstName: 'Ada', lastName: 'Example', dateOfBirth: '1990-01-02',
      nin: '00000000000', phone: '+2348031234567', addressLine: '3 Example Street', city: 'Ikeja', stateCode: 'LA', lga: 'Ikeja',
      hasExistingHealthId: true, existingHealthId: 'HID-ABC234' })
  })
})
