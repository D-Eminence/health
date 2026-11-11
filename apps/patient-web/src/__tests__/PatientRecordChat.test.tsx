import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError, type ApiClient, type RequestSpec } from '@hid/http'
import type { NovuPatientChatReply, NovuPatientChatSourceView } from '@hid/contracts'
import { PatientRecordChat, type PatientRecordChatApi } from '../routes/PatientRecordChat'
import { SelectedPatientChat } from '../routes/SelectedPatientChat'
import { SessionContext, createTestSessionValue } from '../session'
import { createPatientApi } from '../api'

/**
 * The patient's record chat on a Novu build (hid-system #167): the answer as given, its cited sources with where each
 * came from, the source panel, and each failure in plain words with the question kept. Fictional records only.
 */
const TALK = 'Talk to your doctor about what this result means.'
const labId = '22222222-2222-4222-8222-222222222222'
const visitId = '33333333-3333-4333-8333-333333333333'
const typed = (number: number, id: string, kind: string, title: string, originLabel?: string, origin?: string) => ({
  number, kind, id, version: '1', title, recordedAt: '2026-10-01T10:00:00Z', effectiveAt: null, provenance: 'Recorded at a visit',
  quality: 'signed', ...(origin ? { origin } : {}), ...(originLabel ? { originLabel } : {}) }) as NovuPatientChatReply['sources'][number]
const ready: NovuPatientChatReply = { status: 'ready', answer: `Patient One's haemoglobin was 11.2 g/dL [1]. Seen at the clinic [3].\n\n${TALK}`, sources: [
  typed(1, labId, 'lab_result', 'Full blood count', 'Recorded by a health worker', 'health_worker'),
  typed(3, visitId, 'document', 'Discharge letter', 'From a scanned paper record (checked by a health worker)', 'scanned_paper'),
] }
const view: NovuPatientChatSourceView = { kind: 'lab_result', id: labId, kindLabel: 'Lab result', title: 'Full blood count',
  recordedAt: '2026-10-01T10:00:00Z', effectiveAt: '2026-09-30', originLabel: 'Recorded by a health worker',
  provenance: 'Laboratory result', items: [{ label: 'Test', value: 'Haemoglobin' }, { label: 'Value', value: '11.2' }, { label: 'Unit', value: 'g/dL' }],
  notices: ['The lab is correcting this result.', 'Not checked by a clinician.'] }
const empty = { exchanges: [], retentionDays: 30, limit: 10 }

function apiWith(chat: PatientRecordChatApi['chat'], chatSource: PatientRecordChatApi['chatSource'] = vi.fn()) {
  return { chat: vi.fn(chat), chatHistory: vi.fn().mockResolvedValue(empty), clearChatHistory: vi.fn().mockResolvedValue({ cleared: true }),
    chatSource: vi.fn(chatSource) }
}
async function ask(api: PatientRecordChatApi, question = 'What was my blood count?') {
  render(<PatientRecordChat api={api} />)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
}
const box = () => screen.getByLabelText('Your question') as HTMLTextAreaElement

let stored: ReturnType<typeof vi.spyOn>[] = []
beforeEach(() => {
  stored = [vi.spyOn(Storage.prototype, 'setItem')]
})
afterEach(() => {
  // Nothing about a question, an answer or a source is kept in the browser.
  for (const spy of stored) expect(spy).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.unstubAllEnvs()
})

describe('an answer', () => {
  it('shows the answer as given, with the doctor line once, and each source\'s number, title, date and origin', async () => {
    await ask(apiWith(async () => ready))
    expect(await screen.findByText(/haemoglobin was 11.2/)).toBeTruthy()
    expect(screen.getAllByText(TALK)).toHaveLength(1)
    const list = screen.getByRole('region', { name: '2 sources used in this answer' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]!.textContent).toContain('[1]')
    expect(rows[0]!.textContent).toContain('Full blood count')
    expect(rows[0]!.textContent).toContain('1 Oct 2026')
    expect(rows[0]!.textContent).toContain('Recorded by a health worker')
    expect(rows[1]!.textContent).toContain('[3]')
    expect(rows[1]!.textContent).toContain('From a scanned paper record (checked by a health worker)')
  })
  it('shows an answer from a service before the labels as before: the origin in the screen\'s words, or nothing', async () => {
    await ask(apiWith(async () => ({ status: 'ready', answer: 'Recorded [1] [2].', sources: [
      typed(1, labId, 'note', 'Clinic visit', undefined, 'patient'), typed(2, visitId, 'note', 'Older note'),
    ] })))
    await screen.findByText('Recorded [1] [2].')
    expect(screen.getByText('Clinic visit').closest('li')!.textContent).toContain('You added this')
    expect(screen.getByText('Older note').closest('li')!.querySelector('.record-chat-source-origin')).toBeNull()
  })
  it('shows an answer without sources as it did before', async () => {
    await ask(apiWith(async () => ({ status: 'ready', answer: 'Hello. Ask me about your records.', sources: [] })))
    await screen.findByText('Hello. Ask me about your records.')
    expect(screen.queryByRole('region', { name: /sources used/ })).toBeNull()
  })
  it('says what could not be read in plain words, never the service\'s own notes', async () => {
    const coverage = { complete: false, pendingDocuments: 0, recordCount: 3, selectedCount: 1, unavailable: [
      'Laboratory service unavailable; result coverage is unknown',
      'Document extraction unavailable; some attachment contents are not included', 'Something else entirely' ] }
    await ask(apiWith(async () => ({ ...ready, coverage })))
    const note = (await screen.findByText(/could not be read for this answer/)).textContent!
    expect(note).toContain('Your lab results could not be checked just now.')
    expect(note).toContain('Some scanned documents could not be read.')
    for (const words of ['unavailable', 'coverage', 'Something else']) expect(document.body.textContent).not.toContain(words)
  })
  it('says plainly that the record is being prepared, and lets the patient ask again', async () => {
    const chat = vi.fn<PatientRecordChatApi['chat']>().mockResolvedValueOnce({ status: 'preparing', answer: 'Preparing.', sources: [] })
      .mockResolvedValueOnce(ready)
    await ask(apiWith(chat))
    expect(await screen.findByText(/We are still getting your records ready/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }))
    await screen.findByText(/haemoglobin was 11.2/)
    expect(chat).toHaveBeenCalledTimes(2)
    expect(chat.mock.calls[1]![0]).toBe('What was my blood count?')
  })
})

describe('a failed question', () => {
  const cases: Array<[number, string, RegExp, boolean]> = [
    [400, 'INVALID_QUESTION', /could not be sent\. Please write it in 1 to 500 characters/, false],
    [429, 'PATIENT_CHAT_RATE_LIMITED', /several questions in a short time/, false],
    [409, 'CHAT_SOURCES_CHANGED', /Your records changed while we were answering/, true],
    [409, 'CHAT_CONVERSATION_CHANGED', /conversation was cleared while we were answering/, true],
    [409, 'CHAT_ACCESS_CHANGED', /Access to your records changed/, true],
    [503, 'PATIENT_CHAT_UNAVAILABLE', /not working right now/, false],
    [503, 'PATIENT_CHAT_DISABLED', /turned off at the moment/, false],
  ]
  it.each(cases)('%s %s says it in plain words, never the code, and keeps the question', async (status, code, words, again) => {
    await ask(apiWith(async () => { throw new HidApiError(status, 'Problem', { code }) }), 'Is my blood count normal?')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(words)
    expect(document.body.textContent).not.toContain(code)
    expect(box().value).toBe('Is my blood count normal?')
    expect(Boolean(screen.queryByRole('button', { name: 'Ask again' }))).toBe(again)
  })
  it('keeps a new question typed while the failed one was being answered', async () => {
    let fail!: (reason: unknown) => void
    await ask(apiWith(() => new Promise((_resolve, reject) => { fail = reject })), 'First question')
    fireEvent.change(box(), { target: { value: 'Second question' } })
    await act(async () => { fail(new HidApiError(503, 'Problem', { code: 'PATIENT_CHAT_UNAVAILABLE' })) })
    expect(box().value).toBe('Second question')
  })
})

describe('the source panel', () => {
  beforeEach(() => vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1'))

  it('opens a source with every item and every notice, and gives focus back on close', async () => {
    const chatSource = vi.fn(async () => view)
    await ask(apiWith(async () => ready, chatSource))
    const opener = await screen.findByRole('button', { name: 'View source 1: Full blood count' })
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Full blood count' })
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Full blood count' }))
    await within(dialog).findByText('Haemoglobin')
    expect(chatSource).toHaveBeenCalledWith('lab_result', labId, expect.any(AbortSignal))
    const notices = within(dialog).getByRole('note', { name: 'Please note' })
    expect(notices.textContent).toContain('The lab is correcting this result.')
    expect(notices.textContent).toContain('Not checked by a clinician.')
    for (const text of ['Test', 'Haemoglobin', 'Value', '11.2', 'Unit', 'g/dL', 'Recorded by a health worker', 'Laboratory result', '30 Sept 2026']) {
      expect(dialog.textContent).toContain(text)
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View source 1: Full blood count' }))
  })
  it('closes on Escape', async () => {
    await ask(apiWith(async () => ready, async () => view))
    fireEvent.click(await screen.findByRole('button', { name: 'View source 1: Full blood count' }))
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('says a source that is no longer in the current answer is no longer available', async () => {
    await ask(apiWith(async () => ready, async () => { throw new HidApiError(404, 'Gone', { code: 'CHAT_SOURCE_UNAVAILABLE' }) }))
    fireEvent.click(await screen.findByRole('button', { name: 'View source 3: Discharge letter' }))
    const dialog = await screen.findByRole('dialog')
    expect((await within(dialog).findByRole('alert')).textContent)
      .toBe('This source is no longer available. Ask your question again to see its sources.')
    expect(within(dialog).queryByRole('button', { name: 'Try again' })).toBeNull()
  })
  it('offers to try again when a source could not be opened for another reason', async () => {
    const chatSource = vi.fn<PatientRecordChatApi['chatSource']>().mockRejectedValueOnce(new HidApiError(503, 'Down'))
      .mockResolvedValueOnce(view)
    await ask(apiWith(async () => ready, chatSource))
    fireEvent.click(await screen.findByRole('button', { name: 'View source 1: Full blood count' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Haemoglobin')).toBeTruthy()
  })
  it('opens a source from a service before #167, which sends the raw record, through the patient API', async () => {
    const request = vi.fn(async (spec: RequestSpec) => {
      if (spec.method === 'POST') return ready
      if (spec.path.includes('/sources/')) return { kind: 'lab_result', id: labId, version: '1', hash: 'private', title: 'Full blood count',
        recordedAt: '2026-10-01T10:00:00Z', effectiveAt: null, provenance: 'Released laboratory result', quality: 'verified and released',
        origin: 'health_worker', originLabel: 'Recorded by a health worker', fields: { test: 'Haemoglobin', numericValue: 11.2 } }
      return empty
    })
    const api = createPatientApi({ baseUrl: 'https://app.example.test', request } as unknown as ApiClient)
    const patient = { kind: 'patient', subjectId: 'patient-one', appRole: 'patient', assuranceLevel: 'aal1' } as const
    render(<SessionContext.Provider value={createTestSessionValue(patient, api)}><SelectedPatientChat /></SessionContext.Provider>)
    await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
    fireEvent.change(box(), { target: { value: 'What was my blood count?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
    fireEvent.click(await screen.findByRole('button', { name: 'View source 1: Full blood count' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Haemoglobin')
    expect(dialog.textContent).toContain('Numeric value')
    expect(dialog.textContent).toContain('11.2')
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })
  it('is the screen the patient portal selects on a Novu build, reading the source through the patient API', async () => {
    const request = vi.fn(async (spec: RequestSpec) => {
      if (spec.method === 'POST') return { ...ready, sources: ready.sources.map(source => ({ ...source, hash: 'private' })) }
      if (spec.path.includes('/sources/')) return view
      return empty
    })
    const api = createPatientApi({ baseUrl: 'https://app.example.test', request } as unknown as ApiClient)
    const patient = { kind: 'patient', subjectId: 'patient-one', appRole: 'patient', assuranceLevel: 'aal1' } as const
    render(<SessionContext.Provider value={createTestSessionValue(patient, api)}><SelectedPatientChat /></SessionContext.Provider>)
    await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
    fireEvent.change(box(), { target: { value: 'What was my blood count?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
    fireEvent.click(await screen.findByRole('button', { name: 'View source 1: Full blood count' }))
    await screen.findByText('Haemoglobin')
    expect(request.mock.calls.map(([spec]) => [spec.method, spec.path])).toEqual([
      ['GET', '/api/v1/ehr/me/chat/history'], ['POST', '/api/v1/ehr/me/chat'], ['GET', `/api/v1/ehr/me/chat/sources/lab_result/${labId}`],
    ])
  })
})
