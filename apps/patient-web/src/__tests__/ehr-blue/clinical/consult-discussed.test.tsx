import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabOrderReleasedResults, LabResult } from '../../../staff/api'
import type { Chart } from '../../../ehr-blue/clinical/parts/chart'
import { ReleasedResults } from '../../../ehr-blue/clinical/consult/orders/Results'
import {
  DISCUSSED_PERMISSION, WITHDRAWAL_REASONS, discussedProblem, readDiscussionAnswer, readDiscussionList, reasonWords,
} from '../../../ehr-blue/clinical/consult/orders/discussed'
import { FACILITY_ID, FACILITY_NAME, PATIENT_ID, activePatient } from './harness'

/**
 * "Discussed with the patient" under a consultation's released lab results (owner Q24), over hid-system #177's lab-api
 * routes (the calls are faked here; consult-discussed-api.test.ts covers the requests). Everything is fictional.
 */

const api = vi.hoisted(() => ({ labReleasedResultsForOrder: vi.fn() }))
vi.mock('../../../staff/api', () => ({ staffApi: api }))

const calls = vi.hoisted(() => ({ list: vi.fn(), mark: vi.fn(), withdraw: vi.fn() }))
vi.mock('../../../ehr-blue/clinical/consult/orders/discussedApi', () => ({ discussedApi: calls }))

const LAB = 'c0000000-0000-4000-8000-000000000009'
const MARK = 'Discussed with the patient'
const ON_DATE = /^Discussed with the patient on 4 Nov 2026$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

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

/** A result corrected once: version 2 is the one released now, the one the clinician sees. */
const CORRECTED = {
  currentVersion: 2, currentReleasedVersion: 2,
  revisions: [1, 2].map(version => ({ version, resultType: 'text', numericValue: null, textValue: version === 1 ? 'Indeterminate' : 'Non-reactive',
    unit: null, referenceRange: null, abnormalFlag: 'normal', entrySource: 'manual', verificationStatus: 'verified', releaseStatus: 'released',
    enteredAt: '2026-11-03T09:00:00.000Z', releasedAt: '2026-11-03T10:00:00.000Z', correctionReason: version === 2 ? 'Repeat test' : null })),
}

/** One row of lab-api's list, as hid-system #177 answers it. */
function row(overrides: Record<string, unknown> = {}) {
  return { resultId: 'result-1', resultVersion: 1, test: { codeSystem: 'LOINC', code: '00000-0', name: 'Sample screening test' },
    releasedAt: '2026-11-03T10:00:00.000Z', gate: { sensitive: true, critical: false }, finishedVisit: true, discussion: null,
    visibleToPatient: false, ...overrides }
}
const DISCUSSION = { state: 'discussed', eventNo: 1, at: '2026-11-04T09:30:00.000Z', byMembershipId: 'membership-1', reasonCode: null }
const DISCUSSED = { discussion: DISCUSSION, visibleToPatient: true }
const list = (...rows: unknown[]) => readDiscussionList({ results: rows, truncated: false })
const marked = (resultVersion = 1) => readDiscussionAnswer({ resultId: 'result-1', resultVersion, state: 'discussed', eventNo: 1,
  discussedAt: '2026-11-04T09:30:00.000Z', visibleToPatient: true, replayed: false })
const withdrawn = (resultVersion = 1) => readDiscussionAnswer({ resultId: 'result-1', resultVersion, state: 'withdrawn', eventNo: 2,
  withdrawnAt: '2026-11-04T11:00:00.000Z', visibleToPatient: false, replayed: false })

function chart(overrides: Partial<Chart> = {}, permissions: readonly string[] = [DISCUSSED_PERMISSION]): Chart {
  return {
    facilityId: FACILITY_ID, facilityName: FACILITY_NAME, patient: activePatient() as never, patientId: PATIENT_ID, facts: {} as never,
    purpose: 'direct-care', canWrite: true, writeNotice: null,
    can: (...wanted: string[]) => wanted.every(permission => permissions.includes(permission)),
    verify: vi.fn(async () => {}), endAccess: vi.fn(),
    ...overrides,
  }
}

async function show(results: LabResult[], rows: ReturnType<typeof list> | null, given: Chart | null = chart()) {
  api.labReleasedResultsForOrder.mockResolvedValue(released(results))
  calls.list.mockResolvedValue(rows)
  const onRefresh = vi.fn()
  const view = render(<ReleasedResults facilityId={FACILITY_ID} requestId={LAB} revision={0} onRefresh={onRefresh} chart={given ?? undefined} />)
  await screen.findAllByText('Version 1')
  // The held results' read settles.
  await act(async () => {})
  return { onRefresh, view }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function openWithdraw(code: string, reason: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
  fireEvent.change(screen.getByLabelText('Why are you withdrawing it?'), { target: { value: code } })
  fireEvent.change(screen.getByLabelText('Reason for withdrawing'), { target: { value: reason } })
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw the mark' }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the shapes of hid-system #177', () => {
  it('reads the list’s rows, leaving out a malformed one, and nothing from another shape', () => {
    const read = list(row(), row({ resultId: 'result-2', discussion: { ...DISCUSSION, state: 'withdrawn', reasonCode: 'wrong_patient' } }),
      row({ resultId: 'result-3', gate: null }), row({ resultId: 'result-4', resultVersion: 0 }), row({ resultId: 'result-5', discussion: { state: 'maybe' } }))
    expect([...read!.results.keys()]).toEqual(['result-1', 'result-2'])
    expect(read!.results.get('result-2')!.discussion).toEqual({ state: 'withdrawn', eventNo: 1, at: DISCUSSION.at, byMembershipId: 'membership-1',
      reasonCode: 'wrong_patient' })
    expect(readDiscussionList({ items: [] })).toBeNull()
    expect(readDiscussionList(null)).toBeNull()
    expect(marked()).toMatchObject({ state: 'discussed', at: '2026-11-04T09:30:00.000Z', visibleToPatient: true })
    expect(withdrawn()).toMatchObject({ state: 'withdrawn', at: '2026-11-04T11:00:00.000Z', visibleToPatient: false })
    expect(readDiscussionAnswer({ resultId: 'result-1', resultVersion: 1, state: 'discussed', eventNo: 1, visibleToPatient: true })).toBeNull()
  })

  it('says each withdrawal reason code in plain words, never the code', () => {
    expect(WITHDRAWAL_REASONS.map(reason => reason.code)).toEqual(['marked_in_error', 'not_yet_discussed', 'wrong_patient', 'other'])
    expect(reasonWords('marked_in_error')).toBe('Marked by mistake')
    expect(reasonWords('not_yet_discussed')).toBe('Not discussed with the patient yet')
    expect(reasonWords('wrong_patient')).toBe('Marked for the wrong patient')
    expect(reasonWords('other')).toBe('Another reason')
    expect(reasonWords('something_new')).toBe('Another reason')
    for (const reason of WITHDRAWAL_REASONS) expect(reason.words).not.toContain('_')
  })

  it('says a refusal in plain words: 403, 409 for a stale version, and the rest', () => {
    const refused = (status: number, code: string) => discussedProblem(new HidApiError(status, code, { code }), 'Fallback.')
    expect(refused(403, 'PERMISSION_DENIED')).toBe('You do not have permission to mark results as discussed with the patient.')
    expect(refused(403, 'PATIENT_ACCESS_DENIED')).toBe('Your access to this patient does not let you change this. Open the patient again, or ask for write access.')
    expect(refused(409, 'RESULT_VERSION_CHANGED')).toBe('This result has a newer version. Refresh the results and check it before you try again.')
    expect(refused(409, 'RESULT_NOT_RELEASED')).toBe('This version of the result is not released. Refresh the results.')
    expect(refused(409, 'RESULT_ENTERED_IN_ERROR')).toBe('This result was entered in error. Do not use it.')
    expect(refused(409, 'RESULT_NOT_DISCUSSED')).toBe('This result is no longer marked as discussed. Refresh the results.')
    expect(refused(409, 'RESULT_DISCUSSION_CHANGED')).toBe('The mark on this result was changed since this page was read. Refresh the results.')
    expect(refused(409, 'IDEMPOTENCY_KEY_REUSED')).toBe('This could not be saved because the result changed. Refresh the results and try again.')
    expect(refused(404, 'RESULT_NOT_FOUND')).toBe('This result could not be found. Refresh the results.')
    expect(refused(503, 'LAB_SERVICE_UNAVAILABLE')).toBe('Fallback.')
    expect(refused(400, 'RESULT_DISCUSSION_INVALID')).toBe('Fallback.')
    expect(discussedProblem(new Error('network down'), 'Fallback.')).toBe('Fallback.')
  })
})

describe('Discussed with the patient', () => {
  it('reads the patient’s held results for this facility, and shows nothing when the routes are not served', async () => {
    await show([result()], null)
    expect(calls.list).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID)
    expect(screen.queryByRole('button', { name: MARK })).toBeNull()
    expect(document.body.textContent).not.toContain('Discussed')
  })

  it('shows nothing when the list read fails', async () => {
    api.labReleasedResultsForOrder.mockResolvedValue(released([result()]))
    calls.list.mockRejectedValue(new HidApiError(503, 'LAB_SERVICE_UNAVAILABLE', { code: 'LAB_SERVICE_UNAVAILABLE' }))
    render(<ReleasedResults facilityId={FACILITY_ID} requestId={LAB} revision={0} onRefresh={vi.fn()} chart={chart()} />)
    await screen.findAllByText('Version 1')
    await waitFor(() => expect(calls.list).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: MARK })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is offered on held results only: sensitive or critical, and not seen by the patient', async () => {
    await show([
      result({ id: 'result-1' }), result({ id: 'result-2' }), result({ id: 'result-3' }), result({ id: 'result-4' }),
      result({ id: 'result-5', status: 'entered_in_error' }), result({ id: 'result-6' }),
    ], list(
      row({ resultId: 'result-1' }),
      row({ resultId: 'result-2', gate: { sensitive: false, critical: true } }),
      // Gated, but the patient sees it (an older mark on this version, its visit finished): nothing to do.
      row({ resultId: 'result-3', visibleToPatient: true }),
      row({ resultId: 'result-4', gate: { sensitive: false, critical: false } }),
      row({ resultId: 'result-5' }),
      // result-6 is not in the list: not gated.
    ))
    const buttons = screen.getAllByRole('button', { name: MARK })
    expect(buttons).toHaveLength(2)
    const describedBy = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent
    expect(buttons.map(describedBy)).toEqual(['Result 1', 'Result 2'])
  })

  it.each([
    ['without lab.result.discuss', chart({}, ['ehr.lab-request.write'])],
    ['without write access', chart({ canWrite: false })],
    ['under emergency access', chart({ purpose: 'emergency' })],
    ['under emergency (read-only) access', chart({ purpose: 'emergency', canWrite: false })],
    ['without a chart', null],
  ])('is not offered, and the list is not read, %s', async (_, given) => {
    await show([result()], list(row(), row({ resultId: 'result-2', ...DISCUSSED })), given)
    expect(calls.list).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: MARK })).toBeNull()
    expect(document.body.textContent).not.toContain('Discussed')
  })

  it('offers nothing while the version shown is not the one the server holds, or none is released', async () => {
    await show([result({ id: 'result-1', ...CORRECTED }), result({ id: 'result-2', currentReleasedVersion: null })],
      list(row({ resultId: 'result-1', resultVersion: 1 }), row({ resultId: 'result-2' })))
    expect(screen.queryByRole('button', { name: MARK })).toBeNull()
  })

  it('marks after a confirm with the version shown and an Idempotency-Key, keeping focus on the busy button', async () => {
    const given = chart()
    await show([result(CORRECTED)], list(row({ resultVersion: 2 })), given)
    const answer = deferred<unknown>()
    calls.mark.mockReturnValue(answer.promise)
    const button = screen.getByRole('button', { name: MARK })
    button.focus()
    fireEvent.click(button)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('The patient\'s chat can then use this result.')).toBeTruthy()
    expect(calls.mark).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: MARK }))
    await waitFor(() => expect(calls.mark).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, 'result-1', 2, expect.stringMatching(UUID)))
    expect(given.verify).toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { answer.resolve(marked(2)) })
    expect(await screen.findByText(ON_DATE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: MARK })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Withdraw' }))
  })

  it('sends a new Idempotency-Key for each mark asked for', async () => {
    await show([result()], list(row()))
    calls.mark.mockRejectedValue(new Error('network down'))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.click(screen.getByRole('button', { name: MARK }))
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: MARK }))
      await waitFor(() => expect(calls.mark).toHaveBeenCalledTimes(attempt + 1))
      await screen.findByRole('alert')
    }
    expect(calls.mark.mock.calls[0]![4]).not.toBe(calls.mark.mock.calls[1]![4])
  })

  it('says a discussed result’s date, and that the chat waits for the visit to finish', async () => {
    await show([result({ id: 'result-1' }), result({ id: 'result-2' })], list(
      row({ resultId: 'result-1', ...DISCUSSED }),
      row({ resultId: 'result-2', discussion: DISCUSSION, finishedVisit: false, visibleToPatient: false }),
    ))
    expect(screen.getAllByText(ON_DATE)).toHaveLength(2)
    expect(screen.getAllByText('The patient\'s chat will use it once the visit is finished.')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: MARK })).toBeNull()
  })

  it.each(WITHDRAWAL_REASONS.map(reason => [reason.code, reason.words] as const))(
    'says a withdrawn mark’s reason %s in plain words, and offers the mark again', async (code, words) => {
      await show([result()], list(row({ discussion: { ...DISCUSSION, state: 'withdrawn', reasonCode: code } })))
      expect(screen.getByText(`Mark withdrawn on 4 Nov 2026: ${words.toLowerCase()}.`)).toBeTruthy()
      expect(document.body.textContent).not.toMatch(new RegExp(`\\b${code}\\b`))
      expect(screen.getByRole('button', { name: MARK })).toBeTruthy()
    })

  it('does nothing when the confirm is cancelled', async () => {
    await show([result()], list(row()))
    fireEvent.click(screen.getByRole('button', { name: MARK }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(calls.mark).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: MARK })).toBeTruthy()
  })

  it.each([
    [new HidApiError(403, 'Forbidden', { code: 'PERMISSION_DENIED' }), 'You do not have permission to mark results as discussed with the patient.'],
    [new HidApiError(409, 'Conflict', { code: 'RESULT_VERSION_CHANGED' }), 'This result has a newer version. Refresh the results and check it before you try again.'],
    [new HidApiError(500, 'Internal', { code: 'LAB_SERVICE_UNAVAILABLE' }), 'The result could not be marked as discussed. Try again.'],
  ])('says a refused mark in plain words and keeps the button, with focus (%s)', async (refusal, words) => {
    await show([result()], list(row()))
    calls.mark.mockRejectedValue(refusal)
    const button = screen.getByRole('button', { name: MARK })
    button.focus()
    fireEvent.click(button)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: MARK }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(words)
    expect(screen.getByRole('button', { name: MARK })).toBe(button)
    expect(document.activeElement).toBe(button)
    expect(button.getAttribute('aria-busy')).toBeNull()
  })

  it('reads the results again when the answer does not say the new mark', async () => {
    const { onRefresh } = await show([result()], list(row()))
    calls.mark.mockResolvedValue(null)
    fireEvent.click(screen.getByRole('button', { name: MARK }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: MARK }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  })

  it('reads the held results again with every read of the results', async () => {
    const { view } = await show([result()], list(row()))
    view.rerender(<ReleasedResults facilityId={FACILITY_ID} requestId={LAB} revision={1} onRefresh={vi.fn()} chart={chart()} />)
    await waitFor(() => expect(calls.list).toHaveBeenCalledTimes(2))
  })

  it('withdraws only with a reason code and a reason of at least 8 characters, after a confirm', async () => {
    await show([result(CORRECTED)], list(row({ resultVersion: 2, ...DISCUSSED })))
    const answer = deferred<unknown>()
    calls.withdraw.mockReturnValue(answer.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    const code = screen.getByLabelText('Why are you withdrawing it?') as HTMLSelectElement
    expect(document.activeElement).toBe(code)
    expect(Array.from(code.options).map(option => option.textContent)).toEqual(['Choose a reason', 'Marked by mistake',
      'Not discussed with the patient yet', 'Marked for the wrong patient', 'Another reason'])
    const reason = screen.getByLabelText('Reason for withdrawing')
    const submit = screen.getByRole('button', { name: 'Withdraw the mark' })
    fireEvent.change(reason, { target: { value: 'Marked on the wrong result' } })
    fireEvent.click(submit)
    expect(screen.getByText('Choose why you are withdrawing the mark.')).toBeTruthy()
    expect(document.activeElement).toBe(code)
    fireEvent.change(code, { target: { value: 'marked_in_error' } })
    fireEvent.change(reason, { target: { value: ' Mistake ' } })
    fireEvent.click(submit)
    expect(screen.getByText('Give a reason of at least 8 characters.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(reason)
    fireEvent.change(reason, { target: { value: '  Marked on the wrong result  ' } })
    submit.focus()
    fireEvent.click(submit)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('The patient\'s chat will leave this result out again.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw the mark' }))
    await waitFor(() => expect(calls.withdraw).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, 'result-1', 2, 'marked_in_error',
      'Marked on the wrong result', expect.stringMatching(UUID)))
    expect(document.activeElement).toBe(submit)
    expect(submit.getAttribute('aria-busy')).toBe('true')
    await act(async () => { answer.resolve(withdrawn(2)) })
    const mark = await screen.findByRole('button', { name: MARK })
    expect(document.activeElement).toBe(mark)
    expect(screen.getByText('Mark withdrawn on 4 Nov 2026: marked by mistake.')).toBeTruthy()
    expect(screen.queryByText(ON_DATE)).toBeNull()
  })

  it('closes the withdraw form on Cancel, clearing its errors, with focus back on Withdraw', async () => {
    await show([result()], list(row(DISCUSSED)))
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw the mark' }))
    expect(screen.getByText('Give a reason of at least 8 characters.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Reason for withdrawing')).toBeNull()
    const withdraw = screen.getByRole('button', { name: 'Withdraw' })
    expect(document.activeElement).toBe(withdraw)
    fireEvent.click(withdraw)
    expect(screen.queryByText('Give a reason of at least 8 characters.')).toBeNull()
    expect(calls.withdraw).not.toHaveBeenCalled()
  })

  it('says a refused withdrawal in plain words and keeps the reason', async () => {
    await show([result()], list(row(DISCUSSED)))
    calls.withdraw.mockRejectedValue(new HidApiError(409, 'Conflict', { code: 'RESULT_NOT_DISCUSSED' }))
    openWithdraw('wrong_patient', 'Wrong patient chosen')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Withdraw the mark' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('This result is no longer marked as discussed. Refresh the results.')
    expect((screen.getByLabelText('Reason for withdrawing') as HTMLTextAreaElement).value).toBe('Wrong patient chosen')
    expect(screen.getByText(ON_DATE)).toBeTruthy()
  })
})
