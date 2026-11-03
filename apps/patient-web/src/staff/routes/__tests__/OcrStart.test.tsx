import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ocr } from '../Operations'

/**
 * The classic Paper records page (still on the Migrate site's classic sidebar) is a start page like the blue one: no
 * field of any kind, no ID, code or JSON, and links to the Patients page, where paper records start. Fictional data.
 */
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown }))

vi.mock('../../api', () => ({ staffApi: {} }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: staff.activePatient,
    setActivePatient: vi.fn(),
  }),
}))

/** Words a screen of this page must never show. */
const TECHNICAL = /UUID|JSON|Document ID|Patient ID/i

function openPatient(purpose: 'direct-care' | 'emergency') {
  return { hid: 'HID-ZDEMAAA2', purpose,
    lookup: { patient: { patientId: 'a0000000-0000-4000-8000-000000000001', hid: 'HID-ZDEMAAA2', firstName: 'Ada', lastName: 'Fiction', fullName: 'Ada Fiction' } } }
}

function renderOcr() {
  return render(<MemoryRouter><Ocr /></MemoryRouter>)
}

/** No way to type anything: no text box, text input, text area or other form field. */
function expectNothingToType(root: HTMLElement) {
  expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  expect(root.querySelectorAll('input, textarea, select')).toHaveLength(0)
}

beforeEach(() => {
  staff.permissions = ['ocr.job.read', 'ocr.job.write', 'identity.patient.read']
  staff.activePatient = null
})

describe('classic Paper records start page', () => {
  it('has nothing to type and no IDs, codes or JSON', () => {
    const { container } = renderOcr()
    expect(screen.getByRole('heading', { level: 1, name: 'Bring in paper records' })).toBeTruthy()
    expectNothingToType(container)
    expect(container.textContent).not.toMatch(TECHNICAL)
    expect(container.textContent).not.toMatch(/OCR|[0-9a-f]{8}-[0-9a-f]{4}/i)
  })

  it('"Open a patient" links to the Patients page', () => {
    renderOcr()
    expect(screen.getByRole('link', { name: 'Open a patient →' }).getAttribute('href')).toBe('/provider/patients')
  })

  it('names the patient open now, with a link to their page, and no Health ID', () => {
    staff.activePatient = openPatient('direct-care')
    const { container } = renderOcr()
    expect(container.textContent).toContain('Patient open now: Ada Fiction')
    expect(container.textContent).not.toContain('HID-ZDEMAAA2')
    expect(screen.getByRole('link', { name: 'Open Ada’s page →' }).getAttribute('href')).toBe('/provider/patients')
    expectNothingToType(container)
  })

  it('under emergency access says paper records can’t be brought in, and names no patient', () => {
    staff.activePatient = openPatient('emergency')
    renderOcr()
    expect(screen.getByText('Paper records can’t be brought in during emergency access.')).toBeTruthy()
    expect(screen.queryByText(/Patient open now/)).toBeNull()
  })

  it('offers no link to a role that can’t open patients, and says so', () => {
    staff.permissions = ['ocr.job.read']
    renderOcr()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Opening patients isn’t part of your role at this facility.')).toBeTruthy()
  })

  it('refuses a role without ocr.job.read in plain words', () => {
    staff.permissions = ['identity.patient.read']
    const { container } = renderOcr()
    expect(screen.getByRole('heading', { level: 1, name: 'Paper records unavailable' })).toBeTruthy()
    expect(container.textContent).toContain('Bringing in paper records isn’t part of your role at this facility.')
    expect(container.textContent).not.toMatch(/permission|ocr\.job/i)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
