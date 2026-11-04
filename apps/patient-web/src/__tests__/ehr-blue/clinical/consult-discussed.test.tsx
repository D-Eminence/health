import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabOrderReleasedResults, LabResult } from '../../../staff/api'
import type { Chart } from '../../../ehr-blue/clinical/parts/chart'
import { ReleasedResults } from '../../../ehr-blue/clinical/consult/orders/Results'
import { discussedCalls, DISCUSSED_PERMISSION, readHold } from '../../../ehr-blue/clinical/consult/orders/discussed'
import type * as DiscussedModule from '../../../ehr-blue/clinical/consult/orders/discussed'
import { FACILITY_ID, FACILITY_NAME, PATIENT_ID, activePatient } from './harness'

/**
 * "Discussed with the patient" under a consultation's released lab results (owner Q24). Dormant until Session B's API
 * lands: these tests wire fake calls in place of the adapter's. Everything is fictional.
 */

const api = vi.hoisted(() => ({ labReleasedResultsForOrder: vi.fn() }))
vi.mock('../../../staff/api', () => ({ staffApi: api }))

const calls = vi.hoisted(() => ({ wired: true, mark: vi.fn(), withdraw: vi.fn() }))
vi.mock('../../../ehr-blue/clinical/consult/orders/discussed', async importOriginal => {
  const original = await importOriginal<typeof DiscussedModule>()
  return { ...original, discussedCalls: () => calls.wired ? calls : original.discussedCalls() }
})

const LAB = 'c0000000-0000-4000-8000-000000000009'
const MARK = 'Discussed with the patient'
const ON_DATE = /^Discussed with the patient on 4 Nov 2026$/

function result(overrides: Record<string, unknown> = {}): LabResult {
  return {
    id: 'result-1', executionId: 'execution-1', status: 'released', verificationStatus: 'verified', currentVersion: 1, currentReleasedVersion: 1,
    revisions: [{ version: 1, resultType: 'text', numericValue: null, textValue: 'Non-reactive', unit: null, referenceRange: null, abnormalFlag: 'normal',
      entrySource: 'manual', verificationStatus: 'verified', releaseStatus: 'released', enteredAt: '2026-11-03T09:00:00.000Z',
      releasedAt: '2026-11-03T10:00:00.000Z', correctionReason: null }],
    ...overrides,
  } as LabResult
}

function released(results: LabResult[]): LabOrderReleasedResults {
  return { workItemId: 'work-item-1', sourceEhrOrderId: LAB, sourceEhrOrderVersion: 1, patientId: PATIENT_ID, acceptedAt: '2026-11-03T08:00:00.000Z',
    test: { codeSystem: 'LOINC', code: '00000-0', name: 'Sample screening test' }, results }
}

const HELD = { patientChat: { held: true } }
const DISCUSSED = { patientChat: { held: true, discussed: { at: '2026-11-04T09:30:00.000Z' } } }

function chart(overrides: Partial<Chart> = {}, permissions: readonly string[] = [DISCUSSED_PERMISSION]): Chart {
  return {
    facilityId: FACILITY_ID, facilityName: FACILITY_NAME, patient: activePatient() as never, patientId: PATIENT_ID, facts: {} as never,
    purpose: 'direct-care', canWrite: true, writeNotice: null,
    can: (...wanted: string[]) => wanted.every(permission => permissions.includes(permission)),
    verify: vi.fn(async () => {}), endAccess: vi.fn(),
    ...overrides,
  }
}

async function show(results: LabResult[], given: Chart | null = chart()) {
  api.labReleasedResultsForOrder.mockResolvedValue(released(results))
  const onRefresh = vi.fn()
  render(<ReleasedResults facilityId={FACILITY_ID} requestId={LAB} revision={0} onRefresh={onRefresh} chart={given ?? undefined} />)
  await screen.findAllByText('Version 1')
  return { onRefresh }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.wired = true
})

describe('the adapter', () => {
  it('reads the assumed field, and nothing when it is absent or malformed', () => {
    expect(readHold({})).toBeNull()
    expect(readHold({ patientChat: null })).toBeNull()
    expect(readHold({ patientChat: { held: 'yes' } })).toBeNull()
    expect(readHold(HELD)).toEqual({ held: true, discussedAt: null })
    expect(readHold(DISCUSSED)).toEqual({ held: true, discussedAt: '2026-11-04T09:30:00.000Z' })
  })

  it('has no calls until Session B’s API is wired', () => {
    calls.wired = false
    expect(discussedCalls()).toBeNull()
  })
})

describe('Discussed with the patient', () => {
  it('shows nothing at all while the backend does not send the field (today)', async () => {
    await show([result()])
    expect(screen.queryByRole('button', { name: MARK })).toBeNull()
    expect(document.body.textContent).not.toContain('Discussed')
  })

  it('offers no button while the calls are not wired, even if the field is sent', async () => {
    calls.wired = false
    await show([result(HELD)])
    expect(screen.queryByRole('button', { name: MARK })).toBeNull()
  })

  it('is offered on held results only, and not on one entered in error', async () => {
    await show([result({ ...HELD, id: 'result-1' }), result({ id: 'result-2', patientChat: { held: false } }), result({ ...HELD, id: 'result-3', status: 'entered_in_error' })])
    expect(screen.getAllByRole('button', { name: MARK })).toHaveLength(1)
  })

  it.each([
    ['without the permission', chart({}, [])],
    ['without write access', chart({ canWrite: false })],
    ['under emergency (read-only) access', chart({ purpose: 'emergency', canWrite: false })],
    ['without a chart', null],
  ])('is not offered %s', async (_, given) => {
    await show([result(HELD)], given)
    expect(screen.queryByRole('button', { name: MARK })).toBeNull()
  })

  it('shows the date, but no Withdraw, to someone who may not change it', async () => {
    await show([result(DISCUSSED)], chart({ purpose: 'emergency', canWrite: false }))
    expect(screen.getByText(ON_DATE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
  })

  it('marks after a confirm, keeping focus on the busy button, then shows the date and Withdraw', async () => {
    const given = chart()
    await show([result(HELD)], given)
    const answer = deferred<unknown>()
    calls.mark.mockReturnValue(answer.promise)
    const button = screen.getByRole('button', { name: MARK })
    button.focus()
    fireEvent.click(button)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('The patient\'s chat can then use this result.')).toBeTruthy()
    expect(calls.mark).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: MARK }))
    await waitFor(() => expect(calls.mark).toHaveBeenCalledWith(FACILITY_ID, LAB, 'result-1'))
    expect(given.verify).toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { answer.resolve(DISCUSSED) })
    expect(await screen.findByText(ON_DATE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: MARK })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Withdraw' }))
  })

  it('does nothing when the confirm is cancelled', async () => {
    await show([result(HELD)])
    fireEvent.click(screen.getByRole('button', { name: MARK }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(calls.mark).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: MARK })).toBeTruthy()
  })

  it('says a refusal in plain words and keeps the button, with focus', async () => {
    await show([result(HELD)])
    calls.mark.mockRejectedValue(new HidApiError(500, 'Internal', { code: 'PATIENT_CHAT_MARK_FAILED' }))
    const button = screen.getByRole('button', { name: MARK })
    button.focus()
    fireEvent.click(button)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: MARK }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toContain('PATIENT_CHAT_MARK_FAILED')
    expect(alert.textContent).not.toBe('')
    expect(screen.getByRole('button', { name: MARK })).toBe(button)
    expect(document.activeElement).toBe(button)
    expect(button.getAttribute('aria-busy')).toBeNull()
  })

  it('reads the results again when the answer does not say the new state', async () => {
    const { onRefresh } = await show([result(HELD)])
    calls.mark.mockResolvedValue({})
    fireEvent.click(screen.getByRole('button', { name: MARK }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: MARK }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  })

  it('withdraws only with a reason of at least 3 characters, after a confirm', async () => {
    await show([result(DISCUSSED)])
    const answer = deferred<unknown>()
    calls.withdraw.mockReturnValue(answer.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    const reason = screen.getByLabelText('Reason for withdrawing')
    expect(document.activeElement).toBe(reason)
    fireEvent.change(reason, { target: { value: ' ok ' } })
    const submit = screen.getByRole('button', { name: 'Withdraw the mark' })
    fireEvent.click(submit)
    expect(screen.getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(reason)
    fireEvent.change(reason, { target: { value: 'Marked on the wrong result' } })
    submit.focus()
    fireEvent.click(submit)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('The patient\'s chat will leave this result out again.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw the mark' }))
    await waitFor(() => expect(calls.withdraw).toHaveBeenCalledWith(FACILITY_ID, LAB, 'result-1', 'Marked on the wrong result'))
    expect(document.activeElement).toBe(submit)
    expect(submit.getAttribute('aria-busy')).toBe('true')
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { answer.resolve(HELD) })
    const mark = await screen.findByRole('button', { name: MARK })
    expect(document.activeElement).toBe(mark)
    expect(screen.queryByText(ON_DATE)).toBeNull()
  })

  it('says a refused withdrawal in plain words and keeps the reason', async () => {
    await show([result(DISCUSSED)])
    calls.withdraw.mockRejectedValue(new Error('network down'))
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    fireEvent.change(screen.getByLabelText('Reason for withdrawing'), { target: { value: 'Wrong patient' } })
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw the mark' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Withdraw the mark' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('The mark could not be withdrawn. Try again.')
    expect((screen.getByLabelText('Reason for withdrawing') as HTMLTextAreaElement).value).toBe('Wrong patient')
    expect(screen.getByText(ON_DATE)).toBeTruthy()
  })
})
