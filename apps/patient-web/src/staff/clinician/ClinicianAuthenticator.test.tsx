import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { focusWhenShown } from '../../__tests__/focusWhenShown'
import { ClinicianAuthenticator, type ClinicianAuthenticatorProps } from './ClinicianAuthenticator'

/**
 * The applicant's authenticator steps (hid-system ADR-066, P5-P9) and each
 * 0088 answer they can meet. None of them signs anyone out: a refused code
 * stays on its step, an outage keeps what was typed, an expired step is
 * opened again, and only the end of the application page (401
 * CLINICIAN_APPLICATION_SESSION_INVALID) leaves the steps.
 */
const api = vi.hoisted(() => ({
  authenticator: { sendEmailCode: vi.fn(), start: vi.fn(), activate: vi.fn(), verify: vi.fn(), reopen: vi.fn() },
}))
vi.mock('../clinicianApplicationApi', () => ({ clinicianApplicationApi: api }))

const problem = (status: number, code: string) => new HidApiError(status, `Identity's own words for ${code}`, { code })
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const SETUP = { secret: SECRET, otpauthUri: `otpauth://totp/Health%20ID%20Provider:ada%40example.test?secret=${SECRET}&issuer=Health%20ID`,
  algorithm: 'SHA1', digits: 6, periodSeconds: 30, expiresAt: '2026-10-15T09:10:00.000Z' }
const ACCOUNT = { account: { email: 'ada@example.test', fullName: 'Ada Obi' }, stage: 'ready', applications: [], canApply: true }

const handlers = { onReady: vi.fn(), onEnded: vi.fn() }

beforeEach(() => {
  vi.resetAllMocks()
  api.authenticator.sendEmailCode.mockResolvedValue({ accepted: true, channel: 'email', expiresAt: '2026-10-15T09:10:00.000Z' })
  api.authenticator.start.mockResolvedValue(SETUP)
  api.authenticator.reopen.mockResolvedValue({ purpose: 'enroll', expiresAt: '2026-10-15T09:20:00.000Z' })
  api.authenticator.verify.mockResolvedValue(ACCOUNT)
})

function show(start: ClinicianAuthenticatorProps['start']) {
  render(<MemoryRouter><ClinicianAuthenticator start={start} context="signup" email="ada@example.test"
    doneLabel="Continue to your application" onReady={handlers.onReady} onEnded={handlers.onEnded} /></MemoryRouter>)
}

async function stepShown(name: string) {
  const heading = await screen.findByRole('heading', { name })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  return heading
}

function typeCode(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } })
}

async function verifyRefused(caught: HidApiError) {
  api.authenticator.verify.mockRejectedValueOnce(caught)
  show('verify')
  await stepShown('Enter a code from your authenticator app')
  typeCode('Authenticator code', '123456')
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
  await waitFor(() => expect(api.authenticator.verify).toHaveBeenCalledTimes(1))
}

describe('a code the applicant typed (0088 answers on P6-P8)', () => {
  it.each([
    ['401 MFA_INVALID_CODE', problem(401, 'MFA_INVALID_CODE'),
      'That code was not accepted. Each code works once: wait for the next code in your authenticator app, then try again.'],
    ['400 MFA_CODE_REQUIRED', problem(400, 'MFA_CODE_REQUIRED'), 'Enter either an authenticator code or a recovery code.'],
  ])('clears and focuses the field on %s, says why there, and stays', async (_case, caught, words) => {
    await verifyRefused(caught)
    const field = screen.getByLabelText(/^Authenticator code/) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(field.value).toBe('')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(words)).toBeTruthy()
    expect(handlers.onEnded).not.toHaveBeenCalled()
    expect(handlers.onReady).not.toHaveBeenCalled()
  })

  it('says codes are refused for a while on 429 MFA_RATE_LIMITED, with no countdown, and stays', async () => {
    await verifyRefused(problem(429, 'MFA_RATE_LIMITED'))
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Too many incorrect codes. Codes are refused for up to 15 minutes, even a correct one. Try again later.')
    expect(screen.queryByText(/\d+:\d\d|seconds? left|minutes? left/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Enter a code from your authenticator app' })).toBeTruthy()
    expect(handlers.onEnded).not.toHaveBeenCalled()
  })

  it.each([
    ['503 MFA_UNAVAILABLE', problem(503, 'MFA_UNAVAILABLE')],
    ['503 CLINICIAN_APPLICATION_UNAVAILABLE', problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('keeps the step and the code typed through %s: an outage ends nothing', async (_case, caught) => {
    api.authenticator.verify.mockRejectedValueOnce(caught)
    show('verify')
    await stepShown('Enter a code from your authenticator app')
    typeCode('Authenticator code', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't complete this step right now. Try again in a few minutes.")
    expect((screen.getByLabelText(/^Authenticator code/) as HTMLInputElement).value).toBe('123456')
    expect(handlers.onEnded).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(handlers.onReady).toHaveBeenCalledWith(ACCOUNT))
    expect(api.authenticator.verify).toHaveBeenLastCalledWith({ code: '123456' })
  })

  it('opens the step again on 401 MFA_CHALLENGE_INVALID, saying it expired, and never ends the page', async () => {
    await verifyRefused(problem(401, 'MFA_CHALLENGE_INVALID'))
    await stepShown('Start the authenticator step')
    expect(screen.getByRole('alert').textContent).toBe('This step expired. Start it again.')
    expect(handlers.onEnded).not.toHaveBeenCalled()
  })

  it('goes on to the applications when the authenticator is already set up (409 CLINICIAN_APPLICATION_AUTHENTICATOR_READY)', async () => {
    await verifyRefused(problem(409, 'CLINICIAN_APPLICATION_AUTHENTICATOR_READY'))
    await waitFor(() => expect(handlers.onReady).toHaveBeenCalledWith(null))
    expect(handlers.onEnded).not.toHaveBeenCalled()
  })

  it('leaves the steps only when the application page ended (401 CLINICIAN_APPLICATION_SESSION_INVALID)', async () => {
    await verifyRefused(problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID'))
    await waitFor(() => expect(handlers.onEnded).toHaveBeenCalledTimes(1))
    expect(handlers.onReady).not.toHaveBeenCalled()
  })
})

describe('the emailed proof before the setup (P5, P6)', () => {
  it('says the account has no address to confirm with (409 MFA_ENROLLMENT_PROOF_UNAVAILABLE), and offers nothing more', async () => {
    api.authenticator.sendEmailCode.mockRejectedValueOnce(problem(409, 'MFA_ENROLLMENT_PROOF_UNAVAILABLE'))
    show('enrol')
    await stepShown('Set up your authenticator')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown("Your authenticator can't be set up here")
    expect(screen.getByRole('alert').textContent).toBe('There is no email address on this account to confirm the setup. Contact HID support.')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('stays and says to try again when the code could not be emailed (503 MFA_ENROLLMENT_CODE_UNDELIVERABLE)', async () => {
    api.authenticator.sendEmailCode.mockRejectedValueOnce(problem(503, 'MFA_ENROLLMENT_CODE_UNDELIVERABLE'))
    show('enrol')
    await stepShown('Set up your authenticator')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The code could not be sent to your email. Try again in a few minutes.')
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeTruthy()
  })

  it('says too many codes were asked for (429 MFA_RATE_LIMITED), with no countdown', async () => {
    api.authenticator.sendEmailCode.mockRejectedValueOnce(problem(429, 'MFA_RATE_LIMITED'))
    show('enrol')
    await stepShown('Set up your authenticator')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Too many codes were asked for. Wait up to 15 minutes, then try again.')
  })

  it('asks for a new emailed code when the setup was started without one (403 MFA_ENROLLMENT_PROOF_REQUIRED)', async () => {
    api.authenticator.start.mockRejectedValueOnce(problem(403, 'MFA_ENROLLMENT_PROOF_REQUIRED'))
    show('enrol')
    await stepShown('Set up your authenticator')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')
    typeCode('Email code', '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await stepShown('Set up your authenticator')
    expect(screen.getByRole('alert').textContent).toBe('Confirm it is you first: ask for a code by email, then enter it.')
  })

  it('starts the step again when this setup was already confirmed by email (409 MFA_ENROLLMENT_PROOF_COMPLETE)', async () => {
    api.authenticator.sendEmailCode.mockRejectedValueOnce(problem(409, 'MFA_ENROLLMENT_PROOF_COMPLETE'))
    show('enrol')
    await stepShown('Set up your authenticator')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Start the authenticator step')
    expect(screen.getByRole('alert').textContent)
      .toBe('This setup was already confirmed by email but not finished. Start it again to continue.')

    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    await stepShown('Set up your authenticator')
    expect(api.authenticator.reopen).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')
    expect(handlers.onEnded).not.toHaveBeenCalled()
  })
})

describe('an activation whose answer was lost (P7)', () => {
  async function toSetup() {
    show('enrol')
    await stepShown('Set up your authenticator')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')
    typeCode('Email code', '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await stepShown('Add Health ID to your authenticator app')
  }

  it('says the recovery codes cannot be shown again when the activation went through unseen (409 ..._AUTHENTICATOR_READY)', async () => {
    // The first activation committed (factor, recovery codes and the ready stage), but its answer never arrived.
    api.authenticator.activate.mockRejectedValueOnce(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
      .mockRejectedValueOnce(problem(409, 'CLINICIAN_APPLICATION_AUTHENTICATOR_READY'))
    await toSetup()
    typeCode('Authenticator code', '112233')
    fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't complete this step right now. Try again in a few minutes.")
    fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))
    await stepShown('Your authenticator is set up')
    expect(screen.getByRole('alert').textContent).toBe("Your authenticator app is already set up. If you didn't see and save its "
      + "recovery codes, Health ID can't show them again: keep your authenticator app safe, and contact HID support if you lose it.")
    expect(handlers.onReady).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to your application' }))
    expect(handlers.onReady).toHaveBeenCalledWith(null)
    expect(handlers.onEnded).not.toHaveBeenCalled()
  })

  it.each([
    ['sending the emailed code', 'enrol'],
    ['the code from the app', 'verify'],
  ] as const)('goes straight on when the authenticator is already set up at %s', async (_case, start) => {
    const ready = problem(409, 'CLINICIAN_APPLICATION_AUTHENTICATOR_READY')
    api.authenticator.sendEmailCode.mockRejectedValueOnce(ready)
    api.authenticator.verify.mockRejectedValueOnce(ready)
    show(start)
    if (start === 'enrol') {
      await stepShown('Set up your authenticator')
      fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    } else {
      await stepShown('Enter a code from your authenticator app')
      typeCode('Authenticator code', '123456')
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    }
    await waitFor(() => expect(handlers.onReady).toHaveBeenCalledWith(null))
    expect(screen.queryByText(/recovery codes, Health ID can't show them again/)).toBeNull()
  })
})

describe('an account that sets its authenticator up only at staff sign-in (403 CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED)', () => {
  it('says so at activation, never as an outage, and offers nothing more', async () => {
    api.authenticator.activate.mockRejectedValueOnce(problem(403, 'CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED'))
    show('enrol')
    await stepShown('Set up your authenticator')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')
    typeCode('Email code', '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await stepShown('Add Health ID to your authenticator app')
    typeCode('Authenticator code', '112233')
    fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))
    await stepShown("Your authenticator can't be set up here")
    expect(screen.getByRole('alert').textContent)
      .toBe('Your authenticator was reset. Sign in to the provider portal to set it up again, or contact HID support.')
    // The way on is staff sign-in, where the authenticator is set up again.
    expect(screen.getByRole('link', { name: 'Sign in to the provider portal' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.queryByRole('button')).toBeNull()
    expect(handlers.onEnded).not.toHaveBeenCalled()
  })
})

describe('opening the step again (P9)', () => {
  it.each([
    ['403 STAFF_MFA_FACTOR_UNPROVEN', problem(403, 'STAFF_MFA_FACTOR_UNPROVEN'),
      'Your authenticator was set up at platform sign-in. Contact HID support to reset it.'],
    ['403 CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE', problem(403, 'CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE'),
      "This account can't apply for a clinical role. Contact HID support."],
    // An approved clinician, or a facility's staff member, whose authenticator was reset sets it up again only at staff sign-in.
    ['403 CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED', problem(403, 'CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED'),
      'Your authenticator was reset. Sign in to the provider portal to set it up again, or contact HID support.'],
  ])('says what %s means and offers nothing more', async (_case, caught, words) => {
    api.authenticator.reopen.mockRejectedValueOnce(caught)
    show('reopen')
    await stepShown('Start the authenticator step')
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    await stepShown("Your authenticator can't be set up here")
    expect(screen.getByRole('alert').textContent).toBe(words)
    // Only staff sign-in can help an account that sets its authenticator up there.
    expect(screen.queryByRole('link', { name: 'Sign in to the provider portal' }) !== null)
      .toBe(_case.includes('STAFF_SIGN_IN_REQUIRED'))
  })

  it('says the step was started too many times (429 MFA_RATE_LIMITED), and stays', async () => {
    api.authenticator.reopen.mockRejectedValueOnce(problem(429, 'MFA_RATE_LIMITED'))
    show('reopen')
    await stepShown('Start the authenticator step')
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    expect((await screen.findByRole('alert')).textContent)
      .toBe('This step was started too many times. Wait up to 15 minutes, then start it again.')
    expect(screen.getByRole('button', { name: 'Start again' })).toBeTruthy()
  })

  it('goes to the code when the account already has an authenticator', async () => {
    api.authenticator.reopen.mockResolvedValueOnce({ purpose: 'verify', expiresAt: '2026-10-15T09:20:00.000Z' })
    show('reopen')
    await stepShown('Start the authenticator step')
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    await stepShown('Enter a code from your authenticator app')
  })
})

/**
 * Each step, the recovery codes and a refused code take focus in the commit that shows them. From an effect, focus moved
 * a task after a render that followed a request, and a check made as soon as the step was shown (findBy on a busy
 * runner, as on health#16's CI) found it still on the step before. Each test answers the request outside act, as a
 * fetch's answer arrives, and reads focus at the moment what follows is shown.
 */
describe('focus as soon as what follows an answer is shown', () => {
  const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = undefined })

  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
  }

  /** Presses a button the way a keyboard user does: focused, then activated. */
  async function press(name: string) {
    const button = screen.getByRole('button', { name })
    button.focus()
    await act(async () => { fireEvent.click(button) })
  }

  /** Settles a request outside act: React renders the outcome in one task and would run its effects in a later one. */
  function answer(settle: () => void) {
    environment.IS_REACT_ACT_ENVIRONMENT = false
    settle()
  }

  it('has focus on the next step\'s heading as soon as the step is shown (StepHeading)', async () => {
    const sent = deferred<{ accepted: true; channel: 'email'; expiresAt: string }>()
    api.authenticator.sendEmailCode.mockReturnValueOnce(sent.promise)
    show('enrol')
    await stepShown('Set up your authenticator')
    await press('Email me a code')
    const shown = focusWhenShown(() => screen.queryByRole('heading', { name: 'Enter the code we emailed you' }))
    answer(() => sent.resolve({ accepted: true, channel: 'email', expiresAt: '2026-10-15T09:10:00.000Z' }))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on the recovery codes\' heading as soon as they are shown', async () => {
    const activated = deferred<typeof ACCOUNT & { recoveryCodes: string[] }>()
    api.authenticator.activate.mockReturnValueOnce(activated.promise)
    show('enrol')
    await stepShown('Set up your authenticator')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')
    typeCode('Email code', '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await stepShown('Add Health ID to your authenticator app')
    typeCode('Authenticator code', '112233')
    await press('Activate authenticator')
    const shown = focusWhenShown(() => screen.queryByRole('heading', { name: 'Save your recovery codes' }))
    answer(() => activated.resolve({ ...ACCOUNT, recoveryCodes: ['ABCDE-FGHJK', 'MNPQR-STVWX'] }))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on the field as soon as its refused code is said (useStepProblems)', async () => {
    const verified = deferred<typeof ACCOUNT>()
    api.authenticator.verify.mockReturnValueOnce(verified.promise)
    show('verify')
    await stepShown('Enter a code from your authenticator app')
    typeCode('Authenticator code', '123456')
    await press('Verify')
    const shown = focusWhenShown(() => screen.queryByText(/^That code was not accepted\. Each code works once/))
    answer(() => verified.reject(problem(401, 'MFA_INVALID_CODE')))
    const { focused } = await shown
    expect(focused).toBe(screen.getByLabelText(/^Authenticator code/))
  })
})
