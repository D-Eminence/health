import { useEffect, type ReactElement } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentsCard } from '../../../../ehr-blue/clinical/consult/Documents'
import type { Chart } from '../../../../ehr-blue/clinical/parts/chart'
import type { RecordList } from '../../../../ehr-blue/clinical/consult/records'
import { Migrate, NO_DOCUMENT_OCR, NO_PATIENTS, NOT_IN_EMERGENCY } from '../../../../ehr-blue/departments/migrate/Migrate'
import { migratePage } from '../../../../ehr-blue/departments/migrate/page'
import { BluePagesProvider } from '../../../../ehr-blue/frame/pageContext'
import type { EhrBluePage } from '../../../../ehr-blue/frame/types'
import type { DocumentRecord } from '../../../../staff/api'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'

/**
 * Migrate's start page (the owner's rule: "staff should not type"). It has no field of any kind, says no ID, code or
 * JSON, and sends staff to the Patients page to open the patient first. Fictional data only.
 */
const session = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown }))

vi.mock('../../../../staff/api', () => ({ staffApi: {} }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => ({
      ...staffContext(fakeFacility(session.permissions, { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital' })),
      activePatient: session.activePatient,
    }),
  }
})

const PATIENTS: EhrBluePage = {
  path: 'patients/*', group: 'Clinical', label: 'Patients', permission: 'identity.patient.read', status: 'live', element: <p>Patients</p>,
}
/** Words a screen of this page must never show. */
const TECHNICAL = /UUID|JSON|Document ID|Patient ID/i

function openPatient(purpose: 'direct-care' | 'emergency') {
  return { hid: 'HID-ZDEMAAA2', purpose,
    lookup: { patient: { patientId: 'a0000000-0000-4000-8000-000000000001', hid: 'HID-ZDEMAAA2', firstName: 'Ada', lastName: 'Fiction', fullName: 'Ada Fiction' } } }
}

const seen: string[] = []
function Probe() {
  const location = useLocation()
  useEffect(() => { seen.push(location.pathname) }, [location])
  return null
}

function renderMigrate(pages: readonly EhrBluePage[] = [PATIENTS]) {
  return render(
    <MemoryRouter initialEntries={['/provider/ocr']}>
      <Probe />
      <BluePagesProvider value={pages}><div className="hid-ehr"><Migrate /></div></BluePagesProvider>
    </MemoryRouter>,
  )
}

/** No way to type anything: no text box, text input, text area or other form field. */
function expectNothingToType(root: HTMLElement) {
  expect(within(root).queryAllByRole('textbox')).toHaveLength(0)
  expect(within(root).queryAllByRole('combobox')).toHaveLength(0)
  expect(within(root).queryAllByRole('spinbutton')).toHaveLength(0)
  expect(root.querySelectorAll('input, textarea, select')).toHaveLength(0)
}

beforeEach(() => {
  session.permissions = ['ocr.job.read', 'ocr.job.write', 'identity.patient.read']
  session.activePatient = null
  seen.length = 0
})

describe('Migrate start page', () => {
  it('is listed as Paper records, at the OCR address, for ocr.job.read', () => {
    expect(migratePage).toMatchObject({ path: 'ocr', label: 'Paper records', permission: 'ocr.job.read' })
  })

  it('has nothing to type and no IDs, codes or JSON', () => {
    const { container } = renderMigrate()
    expect(screen.getByRole('heading', { level: 1, name: 'Bring in paper records' })).toBeTruthy()
    expect(screen.getByText('Open the patient first. Then tap Bring in paper records on their page.')).toBeTruthy()
    expectNothingToType(container)
    expect(container.textContent).not.toMatch(TECHNICAL)
    expect(container.textContent).not.toMatch(/OCR|[0-9a-f]{8}-[0-9a-f]{4}/i)
  })

  it('"Open a patient" goes to the Patients page', () => {
    renderMigrate()
    const link = screen.getByRole('link', { name: 'Open a patient' })
    expect(link.getAttribute('href')).toBe('/provider/patients')
    fireEvent.click(link)
    expect(seen.at(-1)).toBe('/provider/patients')
  })

  it('names the patient open now, and opens their page', () => {
    session.activePatient = openPatient('direct-care')
    const { container } = renderMigrate()
    expect(screen.getByText('Patient open now: Ada Fiction')).toBeTruthy()
    expect(container.textContent).not.toContain('HID-ZDEMAAA2')
    fireEvent.click(screen.getByRole('link', { name: 'Open Ada’s page' }))
    expect(seen.at(-1)).toBe('/provider/patients/open')
    expectNothingToType(container)
  })

  it('under emergency access says paper records can’t be brought in, and names no patient', () => {
    session.activePatient = openPatient('emergency')
    renderMigrate()
    expect(screen.getByText(NOT_IN_EMERGENCY)).toBeTruthy()
    expect(screen.queryByText(/Patient open now/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Open a patient' })).toBeTruthy()
  })

  it('offers no link to a role that can’t open patients, and says so', () => {
    session.permissions = ['ocr.job.read']
    renderMigrate()
    expect(screen.queryByRole('link', { name: 'Open a patient' })).toBeNull()
    expect(screen.getByText(NO_PATIENTS)).toBeTruthy()
  })

  it('refuses a role without ocr.job.read in plain words, on the page and at its address', () => {
    session.permissions = ['identity.patient.read']
    const { container } = renderMigrate()
    expect(screen.getByRole('alert').textContent).toBe(NO_DOCUMENT_OCR)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.textContent).not.toMatch(/permission|ocr\.job/i)
    const { container: refusal } = renderDept(<>{migratePage.refusal}</>)
    expect(within(refusal).getByRole('heading', { level: 1 }).textContent).toBe('Paper records unavailable')
    expect(refusal.textContent).toContain(NO_DOCUMENT_OCR)
  })
})

describe('the visit Documents card', () => {
  const DOCUMENT = { id: 'doc-1', fileName: 'referral-letter.pdf', mediaType: 'application/pdf', sizeBytes: '2048',
    status: 'uploaded', scanStatus: 'clean' } as unknown as DocumentRecord

  function renderCard(): ReactElement {
    const chart = { facilityId: DEMO_HOSPITAL_ID, patientId: 'a0000000-0000-4000-8000-000000000001', can: () => true,
      verify: async () => {} } as unknown as Chart
    const list = { items: [DOCUMENT], first: [DOCUMENT], more: false, truncated: false, loading: false, error: '', cursors: [], next: null,
      notice: null, show: () => {}, reload: async () => null } as unknown as RecordList<DocumentRecord>
    return <MemoryRouter><DocumentsCard chart={chart} encounterId="encounter-1" list={list} canWrite /></MemoryRouter>
  }

  it('has no "Extract with OCR", and its file picker takes no TIFF', () => {
    const { container } = render(renderCard())
    expect(screen.getByText('referral-letter.pdf')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
    expect(container.textContent).not.toMatch(/OCR|TIFF/)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).not.toMatch(/tif/i)
  })
})
