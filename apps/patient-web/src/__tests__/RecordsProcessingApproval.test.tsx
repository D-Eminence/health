import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type AccessRequest } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { AccessPage } from '../routes/Portal'
import { durationInWords, isRecordsProcessingRequest, paperRecordsOnRecordsProcessingApproval, RECORDS_PROCESSING_GRANT } from '../paperRecordsWording'
import { ToastProvider } from '../kasuwa/toast'

/**
 * A records-processing request (hid-system 0104 D5 sends its purpose; #229 gives its dedicated grant): on a pending one the
 * patient reads the wording given with #229, word for word, with the facility and how long in plain words. Every other
 * request keeps today's line (PaperRecordsWording.test.tsx). Never said to someone under 18 or whose age is unknown, and
 * not once the request is decided.
 */
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

const recordsProcessing: AccessRequest = {
  accessRequestId: '70000000-0000-4000-8000-000000000002', facilityId: 'facility-1', facilityName: 'Lagos General', scope: 'write_records',
  reason: 'Old clinic notes', status: 'pending', requestedDurationMinutes: 1440, requestedAt: '2026-11-11T10:00:00Z',
  approvedAt: null, deniedAt: null, deniedReason: null, purpose: 'healthcare-operations',
}

function renderAccess(request: AccessRequest, dateOfBirth: string | null) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/me/access-requests')) return json([request])
    if (path.endsWith('/me/access-history')) return json({ items: [] })
    if (path.endsWith('/identity/me')) return json({ hid: 'HID-ZDEMAAA2', fullName: 'Adaeze Okafor', dateOfBirth })
    return json({}, 404)
  })
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl: fetchImpl as typeof fetch,
  }), 'patient-web'))
  render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api)}><ToastProvider><AccessPage /></ToastProvider></SessionContext.Provider></MemoryRouter>)
  return fetchImpl
}

async function review() {
  fireEvent.click(await screen.findByRole('button', { name: /^Lagos General/ }))
  return within(screen.getByRole('dialog', { name: 'Lagos General' }))
}

async function profileAnswered(fetched: ReturnType<typeof renderAccess>) {
  await waitFor(() => expect(fetched.mock.calls.some(([url]) => new URL(String(url)).pathname.endsWith('/identity/me'))).toBe(true))
  await act(async () => { await Promise.resolve() })
}

const sentence = (duration: string) => `If you approve, staff at Lagos General can add your paper records to your Health ID record for the next ${duration}. Each one is saved as a draft, and you will only see it after a clinician checks and signs it.`
const TODAY = 'Approving also lets Lagos General add your old paper records to your Health ID while their access lasts.'

describe('a records-processing request before its grant is live (hid-system #229, 0113, not yet deployed)', () => {
  it('keeps today’s line, as approving cannot yet keep paper records as drafts', async () => {
    expect(RECORDS_PROCESSING_GRANT.live).toBe(false)
    renderAccess(recordsProcessing, '1991-03-04')
    const drawer = await review()
    expect(await drawer.findByText(TODAY)).toBeTruthy()
    expect(drawer.queryByText(/saved as a draft/)).toBeNull()
  })
})

describe('a records-processing request, as the patient reads it once its grant is live', () => {
  beforeEach(() => { RECORDS_PROCESSING_GRANT.live = true })
  afterEach(() => { RECORDS_PROCESSING_GRANT.live = false })

  it('is the given sentence, word for word', () => {
    expect(paperRecordsOnRecordsProcessingApproval('Lagos General', '24 hours')).toBe(sentence('24 hours'))
  })

  it('says how long in plain words', () => {
    expect(durationInWords(1440)).toBe('24 hours')
    expect(durationInWords(480)).toBe('8 hours')
    expect(durationInWords(60)).toBe('1 hour')
    expect(durationInWords(30)).toBe('30 minutes')
    expect(durationInWords(1)).toBe('1 minute')
    expect(durationInWords(90)).toBe('1 hour and 30 minutes')
    expect(durationInWords(0)).toBeNull()
    expect(durationInWords(null)).toBeNull()
  })

  it('is recognised by its purpose and its write scope only', () => {
    expect(isRecordsProcessingRequest(recordsProcessing)).toBe(true)
    expect(isRecordsProcessingRequest({ ...recordsProcessing, scope: 'read_records' })).toBe(false)
    expect(isRecordsProcessingRequest({ ...recordsProcessing, purpose: 'direct-care' })).toBe(false)
    expect(isRecordsProcessingRequest({ scope: 'write_records' })).toBe(false)
  })

  for (const [minutes, words] of [[1440, '24 hours'], [480, '8 hours'], [30, '30 minutes']] as const) {
    it(`shows the sentence with the facility and ${words} on a pending request to an adult`, async () => {
      renderAccess({ ...recordsProcessing, requestedDurationMinutes: minutes }, '1991-03-04')
      const drawer = await review()
      expect(await drawer.findByText(sentence(words))).toBeTruthy()
      expect(drawer.queryByText(TODAY)).toBeNull()
    })
  }

  it('leaves other requests with today’s line', async () => {
    renderAccess({ ...recordsProcessing, purpose: 'direct-care' }, '1991-03-04')
    const drawer = await review()
    expect(await drawer.findByText(TODAY)).toBeTruthy()
    expect(drawer.queryByText(/saved as a draft/)).toBeNull()
  })

  it('leaves a request with no purpose (a backend before 0104) with today’s line', async () => {
    const { purpose: _purpose, ...withoutPurpose } = recordsProcessing
    renderAccess(withoutPurpose, '1991-03-04')
    const drawer = await review()
    expect(await drawer.findByText(TODAY)).toBeTruthy()
  })

  it('is not said to someone under 18', async () => {
    const fetched = renderAccess(recordsProcessing, `${new Date().getUTCFullYear() - 10}-01-01`)
    const drawer = await review()
    await profileAnswered(fetched)
    expect(drawer.queryByText(/paper records/)).toBeNull()
  })

  it('is not said while the age is unknown', async () => {
    const fetched = renderAccess(recordsProcessing, null)
    const drawer = await review()
    await profileAnswered(fetched)
    expect(drawer.queryByText(/paper records/)).toBeNull()
  })

  for (const decided of [{ status: 'approved', approvedAt: '2026-11-11T10:05:00Z' }, { status: 'denied', deniedAt: '2026-11-11T10:05:00Z', deniedReason: 'Not now' }]) {
    it(`is not said once the request is ${decided.status}`, async () => {
      const fetched = renderAccess({ ...recordsProcessing, ...decided }, '1991-03-04')
      await review()
      await profileAnswered(fetched)
      expect(screen.queryByText(/paper records/)).toBeNull()
    })
  }
})
