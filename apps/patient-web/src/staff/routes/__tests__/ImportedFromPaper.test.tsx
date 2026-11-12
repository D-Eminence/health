import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import type { LabImport, PharmacyImport } from '../../api'
import { ImportedFromPaper } from '../ImportedFromPaper'

/**
 * "Imported from paper (unverified)": a patient's Lab results or medicines read from paper, newest first, a page at a
 * time, each refusal or failure said in plain words. All data is fictional.
 */
const api = vi.hoisted(() => ({ labImports: vi.fn(), pharmacyImports: vi.fn() }))
vi.mock('../../api', () => ({ staffApi: api }))

afterEach(() => { cleanup(); vi.resetAllMocks() })

const CONSENT = 'The patient has not given consent for this facility to read their record.'

const lab = (overrides: Partial<LabImport> = {}): LabImport => ({
  id: 'lab-import-1', patientId: 'patient-a', status: 'accepted', externalLabName: 'Demo Diagnostics', reportedAt: '2024-02-14T00:00:00.000Z',
  observations: [
    { id: 'obs-2', ordinal: 2, testName: 'White cells', value: '6.1', unit: 'x10^9/L' },
    { id: 'obs-1', ordinal: 1, testName: 'Haemoglobin', value: '11.2', unit: 'g/dL', referenceRange: '12.0-16.0', abnormalFlag: 'low' },
  ],
  ...overrides,
})
const medicine = (overrides: Partial<PharmacyImport> = {}): PharmacyImport => ({
  id: 'medicine-1', patientId: 'patient-a', medicationText: 'Metformin', strengthText: '500 mg', doseText: '1 tablet',
  frequencyText: 'Twice daily', historicalContext: 'From a paper record, page 2.', createdAt: '2026-11-03T09:00:00.000Z', ...overrides,
})

const section = () => screen.getByRole('region', { name: /Imported from paper \(unverified\)/ })

describe('lab results imported from paper', () => {
  it('lists each import with its date as written, its source and its values as stored', async () => {
    api.labImports.mockResolvedValue({ items: [lab()], nextCursor: null })
    render(<ImportedFromPaper kind="lab" facilityId="facility-a" patientId="patient-a" />)
    expect(await screen.findByText('Report date: 14 Feb 2024')).toBeTruthy()
    expect(api.labImports).toHaveBeenCalledWith('facility-a', 'patient-a', undefined, expect.any(AbortSignal))
    expect(screen.getByRole('heading', { level: 2, name: 'Imported from paper (unverified)' })).toBeTruthy()
    expect(section().getAttribute('aria-labelledby')).toBeTruthy()
    expect(within(section()).getByText('Source: Demo Diagnostics')).toBeTruthy()
    expect(within(section()).getAllByRole('listitem').slice(1).map(item => item.textContent)).toEqual([
      'Haemoglobin: 11.2 g/dL · Low · Reference range 12.0-16.0', 'White cells: 6.1 x10^9/L'])
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('says so in one line when nothing was imported', async () => {
    api.labImports.mockResolvedValue({ items: [], nextCursor: null })
    render(<ImportedFromPaper kind="lab" facilityId="facility-a" patientId="patient-a" />)
    expect(await screen.findByText('None imported from paper.')).toBeTruthy()
  })

  it('reads the next page with the cursor on Show more and adds it below', async () => {
    api.labImports.mockResolvedValueOnce({ items: [lab()], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [lab({ id: 'lab-import-2', reportedAt: '2023-05-01', externalLabName: null })], nextCursor: null })
    render(<ImportedFromPaper kind="lab" facilityId="facility-a" patientId="patient-a" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('Report date: 1 May 2023')).toBeTruthy()
    expect(api.labImports).toHaveBeenLastCalledWith('facility-a', 'patient-a', 'cursor-1', expect.any(AbortSignal))
    expect(screen.getByText('Report date: 14 Feb 2024')).toBeTruthy()
    expect(screen.getByText('Source: paper record')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('says when more could not be loaded, and tries the same page again', async () => {
    api.labImports.mockResolvedValueOnce({ items: [lab()], nextCursor: 'cursor-1' })
      .mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'SERVICE_UNAVAILABLE' }))
      .mockResolvedValueOnce({ items: [lab({ id: 'lab-import-2', reportedAt: '2023-05-01' })], nextCursor: null })
    render(<ImportedFromPaper kind="lab" facilityId="facility-a" patientId="patient-a" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('More records could not be loaded. Try again.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Report date: 1 May 2023')).toBeTruthy()
    expect(api.labImports).toHaveBeenLastCalledWith('facility-a', 'patient-a', 'cursor-1', expect.any(AbortSignal))
  })
})

describe('consent withdrawn while reading', () => {
  it('takes away what was shown when the next page is refused for consent', async () => {
    api.labImports.mockResolvedValueOnce({ items: [lab()], nextCursor: 'cursor-1' })
      .mockRejectedValueOnce(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    render(<ImportedFromPaper kind="lab" facilityId="facility-a" patientId="patient-a" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(await screen.findByText(CONSENT)).toBeTruthy()
    expect(screen.queryByText('Report date: 14 Feb 2024')).toBeNull()
  })

  it('shows an import with no observations without breaking', async () => {
    api.labImports.mockResolvedValue({ items: [{ ...lab(), observations: undefined }], nextCursor: null })
    render(<ImportedFromPaper kind="lab" facilityId="facility-a" patientId="patient-a" />)
    expect(await screen.findByText('No values recorded.')).toBeTruthy()
  })
})

describe('medicines imported from paper', () => {
  it('lists each medicine with plain labels and where it came from', async () => {
    api.pharmacyImports.mockResolvedValue({ items: [medicine()], nextCursor: null })
    render(<ImportedFromPaper kind="pharmacy" facilityId="facility-a" patientId="patient-a" />)
    expect(await screen.findByText('Metformin')).toBeTruthy()
    expect(api.pharmacyImports).toHaveBeenCalledWith('facility-a', 'patient-a', undefined, expect.any(AbortSignal))
    expect(screen.getByText('Strength: 500 mg · Dose: 1 tablet · How often: Twice daily')).toBeTruthy()
    expect(screen.getByText('Source: From a paper record, page 2.')).toBeTruthy()
    expect(screen.getByText('Added on 3 Nov 2026')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Imported from paper (unverified) Medicines' })).toBeTruthy()
  })
})

describe('refusals and failures, in plain words', () => {
  it('says the patient has not given consent on 403 CONSENT_REQUIRED, and shows no records', async () => {
    api.pharmacyImports.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    render(<ImportedFromPaper kind="pharmacy" facilityId="facility-a" patientId="patient-a" />)
    expect(await screen.findByText(CONSENT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(section().textContent).not.toMatch(/CONSENT_REQUIRED|403|\/api\//)
  })

  it('says none were found on 404', async () => {
    api.labImports.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
    render(<ImportedFromPaper kind="lab" facilityId="facility-a" patientId="patient-a" />)
    expect(await screen.findByText('None found.')).toBeTruthy()
  })

  it('says anything else could not be loaded, with Retry that reads again', async () => {
    api.labImports.mockRejectedValueOnce(new HidApiError(500, 'Server error', { code: 'INTERNAL_ERROR' }))
      .mockResolvedValueOnce({ items: [lab()], nextCursor: null })
    render(<ImportedFromPaper kind="lab" facilityId="facility-a" patientId="patient-a" />)
    expect(await screen.findByText('These records could not be loaded. Try again.')).toBeTruthy()
    expect(section().textContent).not.toMatch(/INTERNAL_ERROR|500/)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Report date: 14 Feb 2024')).toBeTruthy()
    expect(api.labImports).toHaveBeenCalledTimes(2)
  })

  it('never shows a late answer for the previous patient', async () => {
    let finish!: (value: unknown) => void
    api.labImports.mockImplementation((_facility: string, patient: string) => patient === 'patient-a'
      ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ items: [], nextCursor: null }))
    const view = render(<ImportedFromPaper kind="lab" facilityId="facility-a" patientId="patient-a" />)
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    view.rerender(<ImportedFromPaper kind="lab" facilityId="facility-a" patientId="patient-b" />)
    await screen.findByText('None imported from paper.')
    finish({ items: [lab()], nextCursor: null })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText('Report date: 14 Feb 2024')).toBeNull()
  })
})
