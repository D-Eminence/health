import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type * as StaffApi from '../../../../staff/api'

/*
 * "Add to the emergency board" on the emergency summary (hid-system ED-1 route 1, basis emergency, Q-ED-3 A): only for
 * the emergency search card this session opened the patient from, only to members who add patients to the board, only
 * once the board has answered that it is served (the summary is live while ED_BOARD_ENABLED is off), and sent as
 * emergency with that card's matchRef. Every id and reference is fictional.
 */
const { arrive } = vi.hoisted(() => ({ arrive: vi.fn() }))
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// The workspace is open (no session check holds focus): useFocusById moves focus at once.
vi.mock('../../../../staff/App', () => ({ useStaff: () => ({ lock: null }) }))
vi.mock('../../../../staff/api', async importOriginal => ({
  ...await importOriginal<typeof StaffApi>(),
  edBoardApi: { arrive: (...args: unknown[]) => arrive(...args) },
}))

const FACILITY = 'f0000000-0000-4000-8000-000000000001'
const PATIENT = 'b0000000-0000-4000-8000-0000000000f1'
const ATTENDANCE = 'e0000000-0000-4000-8000-0000000000e1'
const MATCH_REF = `psr_${'C'.repeat(43)}`
const ARRIVE = ['ehr.ed.read', 'ehr.ed.arrive', 'ehr.encounter.read', 'ehr.encounter.write']

afterEach(() => { cleanup(); arrive.mockReset(); vi.resetModules() })

/** `served`: what the board has answered in this page's life (null: nothing yet). */
async function show(permissions: readonly string[], remembered: boolean, patientId = PATIENT, served: boolean | null = true) {
  const memory = await import('../../../../ehr-blue/departments/emergency/emergencyArrival')
  memory.forgetEmergencyCard()
  if (remembered) memory.rememberEmergencyCard(FACILITY, PATIENT, MATCH_REF)
  const rules = await import('../../../../ehr-blue/departments/emergency/edRules')
  rules.forgetEdBoardServed()
  if (served !== null) rules.learnEdBoardServed(served)
  const { EmergencyBoardArrival } = await import('../../../../ehr-blue/departments/emergency/EmergencyBoardArrival')
  return render(<MemoryRouter><EmergencyBoardArrival facilityId={FACILITY} patientId={patientId} permissions={permissions} /></MemoryRouter>)
}

describe('Add to the emergency board from the emergency summary', () => {
  it('sends the remembered emergency card’s matchRef as an emergency arrival, and links to the record', async () => {
    arrive.mockResolvedValue({ outcome: 'arrived', replayed: false, attendance: { attendanceId: ATTENDANCE, fullName: 'Tunde Boardone',
      recordKind: 'standard', unknownLabel: null } })
    await show(ARRIVE, true)
    fireEvent.click(screen.getByRole('button', { name: 'Add to the emergency board' }))
    expect(screen.getByText('Choose how the patient came.')).toBeDefined()
    expect(arrive).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: 'How they came' }), { target: { value: 'police' } })
    const add = screen.getByRole('button', { name: 'Add to the emergency board' })
    add.focus()
    fireEvent.click(add)
    expect(await screen.findByText(/Tunde Boardone is on the board\./)).toBeDefined()
    // The pressed button went with the form: focus is on the result, not lost to the page.
    await waitFor(() => expect(document.activeElement?.id).toBe('ed-emergency-arrival-done'))
    expect(document.activeElement?.getAttribute('role')).toBe('status')
    expect(arrive).toHaveBeenCalledWith(FACILITY, { matchRef: MATCH_REF, emergency: true }, { arrivalMode: 'police' }, expect.any(String))
    expect(screen.getByRole('link', { name: 'Open their record on the board' }).getAttribute('href')).toBe(`/provider/emergency-department/${ATTENDANCE}`)
    expect(document.body.innerHTML).not.toContain(MATCH_REF)
  })

  it('says ED_ARRIVAL_NEEDS_SEARCH in plain words (no active grant, or the search is too old)', async () => {
    await show(ARRIVE, true)
    // The error class of the modules the component was loaded with (they are loaded afresh for each test).
    const { HidApiError } = await import('@hid/http')
    arrive.mockRejectedValue(new HidApiError(403, 'Search first.', { code: 'ED_ARRIVAL_NEEDS_SEARCH' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'How they came' }), { target: { value: 'ambulance' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to the emergency board' }))
    expect(await screen.findByText('Search for the patient first, then add them to the board. A search result can be used for 10 minutes.')).toBeDefined()
  })

  it('offers nothing without a remembered card, for another patient, or to a member who does not add patients', async () => {
    await show(ARRIVE, false)
    expect(screen.queryByRole('button', { name: 'Add to the emergency board' })).toBeNull()
    cleanup()
    await show(ARRIVE, true, 'b0000000-0000-4000-8000-0000000000f2')
    expect(screen.queryByRole('button', { name: 'Add to the emergency board' })).toBeNull()
    cleanup()
    await show(['identity.break-glass.write', 'ehr.encounter.read'], true)
    expect(screen.queryByRole('button', { name: 'Add to the emergency board' })).toBeNull()
  })

  it('offers nothing until the board has answered that it is served: not while it is switched off, not before it answered', async () => {
    // ED_BOARD_ENABLED off (or an ehr-api before 0168): the board answered 503 or 404 in this page's life.
    await show(ARRIVE, true, PATIENT, false)
    expect(screen.queryByRole('region', { name: 'Emergency department board' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add to the emergency board' })).toBeNull()
    cleanup()
    // Nothing answered yet (the summary opened straight from Emergency access, with the board off in production).
    await show(ARRIVE, true, PATIENT, null)
    expect(screen.queryByRole('button', { name: 'Add to the emergency board' })).toBeNull()
    expect(arrive).not.toHaveBeenCalled()
  })

  it('switched off after it answered: the first refusal says the board is not available yet, and the action goes', async () => {
    await show(ARRIVE, true)
    const { HidApiError } = await import('@hid/http')
    arrive.mockRejectedValue(new HidApiError(503, 'Service unavailable', { code: 'ED_BOARD_NOT_AVAILABLE' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'How they came' }), { target: { value: 'ambulance' } })
    const add = screen.getByRole('button', { name: 'Add to the emergency board' })
    add.focus()
    fireEvent.click(add)
    expect(await screen.findByText('The emergency board is not available yet.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add to the emergency board' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'How they came' })).toBeNull()
    // The pressed button went: focus is on the words that replaced it.
    await waitFor(() => expect(document.activeElement?.id).toBe('ed-emergency-arrival-off'))
  })
})
