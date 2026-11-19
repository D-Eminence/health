import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import { PatientRegistration } from '../../../../ehr-blue/departments/registration/Registration'
import {
  NIN_DETAILS_CHECK, NIN_HELD_FEW_MINUTES, NIN_IN_PROGRESS, NIN_STILL_CHECKING, NIN_TAKING_LONGER,
} from '../../../../ninCheck'

/*
 * The desk's NIN check on the blue Patient registration page (POST /identity/nin/resolve; hid-system Q108 and 0137):
 * Identity's answers when it could not finish are said in plain words, never with a code; Verify again with the form
 * unchanged sends the same Idempotency-Key, a changed form a new one; the form says it is still checking after a few
 * seconds. Every person and number here is fictional: Patient One, NIN 12345678901.
 */

vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(['identity.registration.write', 'identity.registration.approve'], {
      id: hospital, name: 'Demo Hospital', roles: ['records_officer'],
    })),
  }
})
const api = vi.hoisted(() => ({
  registrationCapabilities: vi.fn(), registrationCase: vi.fn(), resolveNin: vi.fn(), linkExistingRegistration: vi.fn(),
  approveNewRegistration: vi.fn(), enrollRegistration: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const NIN = '12345678901'
const CASE = 'c0000000-0000-4000-8000-000000000001'
const ENABLED = { nin: { enabled: true, state: 'enabled' }, newPatientRegistrationRequiresNin: true }
const pending = { caseId: CASE, status: 'pending_new_identity_approval', version: 1, candidateCount: 0 }
const VERIFY = 'Verify and create case'

beforeEach(() => {
  vi.clearAllMocks()
  api.registrationCapabilities.mockResolvedValue(ENABLED)
  api.registrationCase.mockResolvedValue(pending)
})
afterEach(() => { vi.useRealTimers() })

/** Each answer as the client throws it, and the words the desk sees. */
const ANSWERS: Array<[string, () => HidApiError, string]> = [
  ['409 NIN_CHECK_IN_PROGRESS', () => new HidApiError(409, 'x', { code: 'NIN_CHECK_IN_PROGRESS',
    detail: 'This NIN check is already in progress. Please wait for its answer.' }), NIN_IN_PROGRESS],
  ['409 NIN_CHECK_HELD without a time', () => new HidApiError(409, 'x', { code: 'NIN_CHECK_HELD' }), NIN_HELD_FEW_MINUTES],
  ['504 QOREID_TIMEOUT', () => new HidApiError(504, 'x', { code: 'QOREID_TIMEOUT', retryInSeconds: 60 }), NIN_TAKING_LONGER],
  ['this client’s own wait ending', () => new HidApiError(0, 'x', { code: 'REQUEST_TIMEOUT' }), NIN_TAKING_LONGER],
  ['400 NIN_DETAILS_INVALID', () => new HidApiError(400, 'x', { code: 'NIN_DETAILS_INVALID',
    detail: 'Check the name and the date of birth.' }), NIN_DETAILS_CHECK],
]

async function openNew() {
  renderDept(<PatientRegistration />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create record' }))
  await screen.findByLabelText(/^National Identity Number/)
}
function fill({ first = 'Patient' } = {}) {
  fireEvent.input(screen.getByLabelText(/^National Identity Number/), { target: { value: NIN } })
  fireEvent.input(screen.getByLabelText(/^First name/), { target: { value: first } })
  fireEvent.input(screen.getByLabelText(/^Last name/), { target: { value: 'One' } })
  fireEvent.input(screen.getByLabelText(/^Date of birth/), { target: { value: '1990-01-02' } })
  fireEvent.input(screen.getByLabelText(/^Phone/), { target: { value: '0803 123 4567' } })
  fireEvent.input(screen.getByLabelText(/^Address/), { target: { value: '3 Example Street' } })
  fireEvent.input(screen.getByLabelText(/^City or town/), { target: { value: 'Ikeja' } })
  fireEvent.change(screen.getByLabelText(/^State/), { target: { value: 'LA' } })
  fireEvent.input(screen.getByLabelText(/^Local government area/), { target: { value: 'Ikeja' } })
  fireEvent.change(screen.getByLabelText(/^Does the patient already have a Health ID/), { target: { value: 'no' } })
}
const verifyButton = () => screen.getByRole('button', { name: VERIFY }) as HTMLButtonElement
function expectNoCode() {
  expect(document.body.textContent).not.toMatch(/NIN_CHECK|QOREID|NIN_DETAILS|REQUEST_TIMEOUT|\b(400|409|504)\b|already in progress|Please wait/)
}

describe('the desk NIN check', () => {
  it.each(ANSWERS)('says %s plainly, with no code', async (_name, answer, text) => {
    api.resolveNin.mockRejectedValueOnce(answer())
    await openNew()
    fill()
    fireEvent.click(verifyButton())
    expect((await screen.findByText(text)).getAttribute('role')).toBe('alert')
    expectNoCode()
  })

  it('marks the name and date of birth when Identity refuses them', async () => {
    api.resolveNin.mockRejectedValueOnce(ANSWERS[4]![1]())
    await openNew()
    fill()
    fireEvent.click(verifyButton())
    await screen.findByText(NIN_DETAILS_CHECK)
    for (const label of [/^Date of birth/, /^First name/, /^Last name/]) {
      await waitFor(() => expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('true'))
    }
    expect(screen.getByLabelText(/^National Identity Number/).getAttribute('aria-invalid')).not.toBe('true')
  })

  it.each([ANSWERS[0]!, ANSWERS[2]!, ANSWERS[3]!])('after %s, Verify again with the form unchanged sends the same key', async (_name, answer, text) => {
    api.resolveNin.mockRejectedValueOnce(answer()).mockResolvedValueOnce(pending)
    await openNew()
    fill()
    fireEvent.click(verifyButton())
    await screen.findByText(text)
    fireEvent.click(verifyButton())
    await waitFor(() => expect(api.resolveNin).toHaveBeenCalledTimes(2))
    const [first, second] = api.resolveNin.mock.calls
    expect(first?.[2]).toMatch(/^[0-9a-f-]{36}$/)
    expect(second?.[2]).toBe(first?.[2])
    await screen.findByRole('heading', { level: 1, name: 'Registration for Patient One' })
  })

  it('a changed detail gets a new key', async () => {
    api.resolveNin.mockRejectedValueOnce(ANSWERS[2]![1]()).mockResolvedValueOnce(pending)
    await openNew()
    fill()
    fireEvent.click(verifyButton())
    await screen.findByText(NIN_TAKING_LONGER)
    fireEvent.input(screen.getByLabelText(/^First name/), { target: { value: 'Patience' } })
    fireEvent.click(verifyButton())
    await waitFor(() => expect(api.resolveNin).toHaveBeenCalledTimes(2))
    const [first, second] = api.resolveNin.mock.calls
    expect(second?.[1]).toMatchObject({ firstName: 'Patience' })
    expect(second?.[2]).not.toBe(first?.[2])
  })

  it('details refused are a new request next time, even unchanged', async () => {
    api.resolveNin.mockRejectedValueOnce(ANSWERS[4]![1]()).mockResolvedValueOnce(pending)
    await openNew()
    fill()
    fireEvent.click(verifyButton())
    await screen.findByText(NIN_DETAILS_CHECK)
    fireEvent.click(verifyButton())
    await waitFor(() => expect(api.resolveNin).toHaveBeenCalledTimes(2))
    const [first, second] = api.resolveNin.mock.calls
    expect(second?.[2]).not.toBe(first?.[2])
  })

  it('a held NIN says when to try again, and Verify stays off until then', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.resolveNin.mockRejectedValueOnce(new HidApiError(409, 'x', { code: 'NIN_CHECK_HELD', retryInSeconds: 300 }))
    await openNew()
    fill()
    fireEvent.click(verifyButton())
    await screen.findByText(/^This NIN check is on hold\. Try again after \d{1,2}:\d{2}( [AP]M)?( tomorrow)?\.$/)
    expectNoCode()
    expect(verifyButton().disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    expect(verifyButton().disabled).toBe(false)
  })

  it('says it is still checking after a few seconds, and not before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let answer: (value: unknown) => void = () => {}
    api.resolveNin.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    await openNew()
    fill()
    fireEvent.click(verifyButton())
    expect(screen.queryByText(NIN_STILL_CHECKING)).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(screen.getByText(NIN_STILL_CHECKING).closest('[role="status"]')).not.toBeNull()
    await act(async () => { answer(pending) })
    await screen.findByRole('heading', { level: 1, name: 'Registration for Patient One' })
    expect(screen.queryByText(NIN_STILL_CHECKING)).toBeNull()
  })
})
