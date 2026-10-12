import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Clinical } from '../Clinical'
import { Patients } from '../Patients'

/**
 * The clinical record's structure. PEHR-09 / A11Y-BR-08: with an encounter
 * selected the record had two h1 headings, the patient's name and "Care
 * documentation". PEHR-10: its record sections were a role=tablist of
 * role=tab buttons with no panels, ids, roving tabindex or arrow keys, with the
 * encounter status card between the tabs and their content; and Patient
 * access used the same markup for a choice of access method, which is not a
 * tab set. NEW-PEHR-DETAIL-RUNON: a label and its value ran together
 * ("Recorded12/10/2026…"), and note content lost its line breaks.
 */
const api = vi.hoisted(() => ({ lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(),
  documents: vi.fn(), requestAccess: vi.fn(), verifyPin: vi.fn(), breakGlass: vi.fn(), closeGrant: vi.fn() }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['identity.patient.read', 'identity.consent.write', 'identity.patient-access-pin.verify', 'identity.break-glass.write',
        'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.vital.read', 'ehr.diagnosis.read'],
    } } } },
    activePatient: { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup },
    setActivePatient: vi.fn(() => true),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, breakGlass: false } }
const note = { id: 'note-1', patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z',
  noteType: 'Consultation', title: 'Admission note', status: 'signed', rowVersion: '2' }

beforeEach(() => {
  vi.clearAllMocks()
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
    status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) =>
    ({ items: kind === 'clinical-notes' ? [note] : [], nextCursor: null }))
})

async function openRecord() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  await screen.findByText('Admission note')
}

describe('PEHR-09 / A11Y-BR-08: one h1 on the clinical record', () => {
  it('keeps the patient’s name as the only h1, with care documentation an h2 naming its section', async () => {
    await openRecord()
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['Ada Patient'])
    const documentation = screen.getByRole('heading', { level: 2, name: 'Care documentation' })
    expect(screen.getByRole('region', { name: 'Care documentation' }).contains(documentation)).toBe(true)
  })
})

describe('PEHR-10: the record sections are a working tab set', () => {
  it('ties each tab to its panel', async () => {
    await openRecord()
    const tabs = within(screen.getByRole('tablist', { name: 'Clinical record section' })).getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Notes', 'Vitals', 'Diagnoses'])
    const panel = screen.getByRole('tabpanel')
    const selected = tabs.find(tab => tab.getAttribute('aria-selected') === 'true')!
    expect(selected.textContent).toBe('Notes')
    expect(selected.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(selected.id)
    expect(within(panel).getByText('Admission note')).toBeTruthy()
  })

  it('puts only the selected tab in the tab order, and moves with the arrow keys', async () => {
    await openRecord()
    const tab = (name: string) => screen.getByRole('tab', { name })
    expect([tab('Notes').tabIndex, tab('Vitals').tabIndex, tab('Diagnoses').tabIndex]).toEqual([0, -1, -1])
    tab('Notes').focus()
    fireEvent.keyDown(tab('Notes'), { key: 'ArrowRight' })
    await waitFor(() => expect(tab('Vitals').getAttribute('aria-selected')).toBe('true'))
    expect(document.activeElement).toBe(tab('Vitals'))
    expect(tab('Vitals').tabIndex).toBe(0)
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith('facility-1', PATIENT, ENCOUNTER, 'vitals'))
    fireEvent.keyDown(tab('Vitals'), { key: 'End' })
    await waitFor(() => expect(document.activeElement).toBe(tab('Diagnoses')))
  })

  it('places the encounter status before the tabs, not between the tabs and their panel', async () => {
    await openRecord()
    const status = screen.getByRole('button', { name: 'Update status' })
    const tablist = screen.getByRole('tablist', { name: 'Clinical record section' })
    expect(status.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('PEHR-10: the patient access method is a choice of buttons, not tabs', () => {
  it('offers the methods as pressed and unpressed buttons in a named group', () => {
    render(<MemoryRouter><Patients /></MemoryRouter>)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryAllByRole('tab')).toEqual([])
    const group = screen.getByRole('group', { name: 'Access method' })
    expect(within(group).getByRole('button', { name: 'Request', pressed: true })).toBeTruthy()
    const pin = within(group).getByRole('button', { name: 'Patient PIN', pressed: false })
    fireEvent.click(pin)
    expect(within(group).getByRole('button', { name: 'Patient PIN', pressed: true })).toBeTruthy()
    expect(within(group).getByRole('button', { name: 'Request', pressed: false })).toBeTruthy()
    expect(screen.getByLabelText(/^Patient access PIN/)).toBeTruthy()
  })
})

describe('NEW-PEHR-DETAIL-RUNON: labels, values and line breaks', () => {
  it('separates a detail’s label from its value', async () => {
    await openRecord()
    const recorded = screen.getByText(/^Recorded/, { selector: '.staff-detail span' })
    expect(recorded.closest('.staff-detail')?.textContent).toMatch(/^Recorded: \S/)
  })
})

describe('the stylesheet gives the record’s structure its look', () => {
  // A path, not a URL: jsdom replaces the global URL class, which Node's file API refuses.
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  /** The declarations of every rule whose selector list includes `selector`. */
  function declarations(selector: string) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selectors]) => selectors!.split(',').map(item => item.trim()).includes(selector))
      .map(([, , body]) => body!).join(';')
  }

  it('keeps note content’s line breaks and lets long words wrap', () => {
    expect(declarations('.staff-note-content')).toMatch(/white-space:\s*pre-wrap/)
    expect(declarations('.staff-note-content')).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('sets a detail’s label apart from its value', () => {
    expect(declarations('.staff-detail')).toMatch(/display:\s*flex/)
    expect(declarations('.staff-detail span')).toMatch(/color:\s*var\(--color-muted\)/)
  })

  it('styles care documentation’s h2 as the page head’s h1', () => {
    expect(declarations('.staff-page-head h2')).toBe(declarations('.staff-page-head h1'))
  })

  it('marks the selected tab and the pressed access method by their state, not a class', () => {
    expect(declarations(".staff-tabs button[aria-selected='true']")).toMatch(/background:\s*var\(--color-brand-tint\)/)
    expect(declarations(".staff-tabs button[aria-pressed='true']")).toMatch(/background:\s*var\(--color-brand-tint\)/)
    // TabList sizes its buttons with h-10; the staff tabs keep their own height.
    expect(declarations('.staff-tabs button')).toMatch(/height:\s*auto/)
  })
})
