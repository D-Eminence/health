import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consultationLabel } from '../../../plainLabels'
import { servedHere } from '../../../productSites'
import { REAL_FACILITY, SESSION, facility, json, serve, sessionAt } from '../frame/blueHarness'
import { backToTestSite, onSite } from '../../sites/siteHarness'

/**
 * On the EHR's own site, Consultation › Documents' "Extract with OCR" opens Document OCR there, with the document
 * filled in: the whole app as ehr. serves it (its own redirects first, then the staff app and the blue EHR on the real,
 * merged registry), at a fictional clinic, through Find a patient (the patient's permission), the visit and its
 * Documents card. ehr. serves every staff page, OCR included (productSites.ts, #68), so the hand-off stays here and is
 * never sent to Migrate's site. The host is only the page's address and fetch is stubbed: nothing is sent anywhere.
 * Every account, facility, patient and document here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const EHR = 'ehr.healthidentitydirectory.com'
const CLINIC = 'Riverside Clinic (fictional)'
/** Finding a patient, Consultation, the visit's documents, and Document OCR: nothing more. */
const PERMISSIONS = ['identity.patient.read', 'ehr.encounter.read', 'ehr.document.read', 'ocr.job.read']
const ACTOR_ID = 'staff-demo-1'
const GRANT_ID = 'grant-ocr-c1'
const PATIENT_ID = 'a0000000-0000-4000-8000-0000000000c1'
const PATIENT_HID = 'HID-ZDEMAAA2'
const PATIENT_NAME = 'Ngozi Example (fictional)'
const ENCOUNTER_ID = 'e0000000-0000-4000-8000-0000000000c1'
const DOCUMENT_ID = 'd0000000-0000-4000-8000-0000000000c1'

const LOOKUP = 'POST /api/v1/identity/patient-lookup'
const CONSENT = 'POST /api/v1/identity/consent-status'
const ENCOUNTERS = `GET /api/v1/ehr/patients/${PATIENT_ID}/encounters`
const ENCOUNTER_READ = `GET /api/v1/ehr/patients/${PATIENT_ID}/encounters/${ENCOUNTER_ID}`
const DOCUMENTS = 'GET /api/v1/ehr/documents'
const OCR_JOBS = 'GET /api/v1/ocr/jobs'

const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: REAL_FACILITY, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-11-02T08:00:00.000Z', chiefComplaint: 'Cough for a week (fictional)', rowVersion: 1,
}
const DOCUMENT = {
  id: DOCUMENT_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, fileName: 'referral-letter.pdf', mediaType: 'application/pdf',
  sizeBytes: '20480', status: 'available', scanStatus: 'clean', createdAt: '2026-11-02T08:30:00.000Z',
}
const many = <T,>(answer: T, count = 20): T[] => Array.from({ length: count }, () => answer)
const allowed = () => json({
  authorization: { decision: 'allow', consentGrantId: GRANT_ID, scope: 'read_records', expiresAt: '2026-11-02T18:00:00.000Z', breakGlass: false },
  patient: { patientId: PATIENT_ID, hid: PATIENT_HID, fullName: PATIENT_NAME },
})

/** Where the app is within this site, and every address it has been at, in order. */
function Address({ seen }: { seen: string[] }) {
  const location = useLocation()
  const at = location.pathname + location.search + location.hash
  useEffect(() => { if (seen.at(-1) !== at) seen.push(at) }, [at, seen])
  return <>
    <span data-testid="address" hidden>{at}</span>
    <span data-testid="history-state" hidden>{JSON.stringify(location.state ?? null)}</span>
  </>
}
const address = () => screen.getByTestId('address').textContent

/** The whole app, signed in at the clinic, as the browser opens `path` on the EHR's site. */
async function openOnEhr(path: string) {
  const clinic = facility(REAL_FACILITY, CLINIC, PERMISSIONS)
  const sent = serve({
    [SESSION]: many(sessionAt(clinic, [clinic])),
    [LOOKUP]: many(allowed),
    [CONSENT]: many(() => json({ patientId: PATIENT_ID, facilityId: REAL_FACILITY, purpose: 'direct-care', readAllowed: true, writeAllowed: false })),
    [ENCOUNTERS]: many(() => json({ items: [ENCOUNTER], nextCursor: null })),
    [ENCOUNTER_READ]: many(() => json(ENCOUNTER)),
    [DOCUMENTS]: many(() => json({ items: [DOCUMENT], nextCursor: null })),
    [OCR_JOBS]: [() => json({ job: null })],
  })
  onSite(EHR, path)
  const { App } = await import('../../../App')
  const seen: string[] = []
  render(<MemoryRouter initialEntries={[path]}><Address seen={seen} /><App /></MemoryRouter>)
  return { sent, seen }
}

describe('Extract with OCR on the EHR’s own site', () => {
  it('opens Document OCR here, with the document filled in, and puts nothing about the patient in the address', async () => {
    const { seen } = await openOnEhr('/provider/patients')

    // The chart opens only with the patient's permission: Find a patient's lookup, which Identity allows.
    // The first wait loads the real app's lazy pages cold (registration-ehr-only.test.tsx).
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }, { timeout: 25000 }), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    expect(await screen.findByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()

    // The visit, from "Visits here", and its Documents card.
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${consultationLabel(ENCOUNTER)}`) }))
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    const documents = screen.getByRole('heading', { level: 2, name: 'Documents' }).closest('section') as HTMLElement
    const link = await within(documents).findByRole('link', { name: 'Extract with OCR' })
    // A link within this site, to today's OCR address: no other site's, and no id in it.
    expect(link.getAttribute('href')).toBe('/provider/ocr')
    fireEvent.click(link)

    // Served here: no other site opened, and the page does not say it is opening one.
    await waitFor(() => expect(address()).toBe('/provider/ocr'))
    expect(screen.queryByText(/Opening it there/)).toBeNull()
    expect(opened).not.toHaveBeenCalled()

    // The blue Document OCR, with the document chosen in Find document job.
    expect(await screen.findByRole('heading', { level: 1, name: 'Document OCR' })).toBeTruthy()
    const find = screen.getByRole('form', { name: 'Find document job' })
    expect((within(find).getByLabelText(/^Document ID/) as HTMLInputElement).value).toBe(DOCUMENT_ID)
    // The hand-off is spent: the history entry keeps no ids.
    await waitFor(() => expect(screen.getByTestId('history-state').textContent).toBe('null'))

    // The document filled in is the one OCR is asked about.
    fireEvent.click(within(find).getByRole('button', { name: 'Find job' }))
    expect(await screen.findByText('No OCR job for this document')).toBeTruthy()
    const asked = vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url))).filter(url => url.pathname === '/api/v1/ocr/jobs')
    expect(asked.map(url => url.searchParams.get('documentId'))).toEqual([DOCUMENT_ID])

    // Still on ehr., and nothing ever opened another site.
    expect(window.location.hostname).toBe(EHR)
    expect(address()).toBe('/provider/ocr')
    expect(opened).not.toHaveBeenCalled()
    // Every address the journey took: main's own, the encounter's id the only id among them, as before.
    expect(seen).toEqual(['/provider/patients', '/provider/patients/open', `/provider/clinical/${ENCOUNTER_ID}`, '/provider/ocr'])
    for (const id of [PATIENT_ID, PATIENT_HID, DOCUMENT_ID, REAL_FACILITY, ACTOR_ID, GRANT_ID]) {
      for (const at of seen) expect(at).not.toContain(id)
    }
    // And the rule behind it (#68): the EHR's site serves Document OCR itself.
    expect(servedHere('/provider/ocr', EHR)).toBe(true)
  })
})
