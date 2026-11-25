import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, serve, sessionAt, type Sent } from '../../frame/blueHarness'

/*
 * The emergency department board's review fixes (hid-system#337 / health#330): an arrival answered already_on_board
 * says plainly that the triage level and complaint entered were not saved (the board keeps the record as it was).
 * Every account, facility, patient and reference is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(async () => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { emergencyDepartmentPage } = await import('../../../../ehr-blue/departments/emergency/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home,
        './departments/pages.ts': { pages: [emergencyDepartmentPage] } }),
    }
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const ARRIVE = 'POST /api/v1/ehr/ed-attendances'
const SEARCH = 'POST /api/v1/identity/patient-search'
const ATTENDANCE = 'e0000000-0000-4000-8000-0000000000e1'
const PATIENT = 'b0000000-0000-4000-8000-0000000000f1'
const MATCH_REF = `psr_${'B'.repeat(43)}`
const ED = ['ehr.ed.read', 'ehr.encounter.read', 'ehr.encounter.write']
const NURSE = [...ED, 'ehr.ed.arrive', 'ehr.ed.triage', 'ehr.note.write', 'identity.patient.read', 'identity.registration.write']

function card(overrides: Record<string, unknown> = {}) {
  return {
    attendanceId: ATTENDANCE, entryId: 'a0000000-0000-4000-8000-0000000000a1', patientId: PATIENT, fullName: 'Tunde Boardone',
    recordKind: 'standard', unknownLabel: null, sex: 'male', dateOfBirth: '1984-03-09', dateOfBirthEstimated: false,
    healthIdLast4: 'BB33', chartBlocked: false, arrivalBasis: 'search', arrivalMode: 'ambulance', arrivedAt: '2026-12-03T08:10:00.000Z',
    minutesInDepartment: 42, column: 'waiting', stage: 'waiting', triageLevel: null, triagedAt: null,
    triagedByMembershipId: null, presentingComplaint: null, complaintHidden: false,
    assignedMembershipId: null, encounterId: null, status: 'open', disposition: null, leftAt: null, rowVersion: 3, ...overrides,
  }
}
const sentTo = (sent: readonly Sent[], route: string) => sent.filter(call => call.route === route)

async function chooseFromSearch() {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'hid-bbbb33' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
  const found = await screen.findByRole('listitem', { name: 'Tunde Boardone' })
  fireEvent.click(within(found).getByRole('button', { name: 'Choose Tunde Boardone' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'How they came' }), { target: { value: 'walk_in' } })
}
const searchAnswer = () => json({ mode: 'standard', outcome: 'found', reach: 'everywhere', message: null, patients: [{
  matchRef: MATCH_REF, matchRefExpiresAt: '2999-01-01T00:00:00.000Z', fullName: 'Tunde Boardone', sex: 'male',
  dateOfBirth: '1984-03-09', healthIdLast4: 'BB33', ninStatus: 'verified' }] })

describe('Emergency department board review fixes', () => {
  it('says plainly that a triage level and complaint entered for a patient already on the board were not saved', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [SEARCH]: [searchAnswer],
      [ARRIVE]: [() => json({ outcome: 'already_on_board', attendance: card(), replayed: false })],
    })
    await openStaffApp('/provider/emergency-department/new')
    await chooseFromSearch()
    fireEvent.change(screen.getByRole('combobox', { name: /Triage level/ }), { target: { value: '1' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Presenting complaint/ }), { target: { value: 'Chest pain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Tunde Boardone is already on the board.')).toBeDefined()
    expect(sentTo(sent, ARRIVE)[0]!.body).toEqual({ matchRef: MATCH_REF, arrivalMode: 'walk_in', triageLevel: 1, presentingComplaint: 'Chest pain' })
    const notSaved = screen.getByRole('alert')
    expect(within(notSaved).getByText('The triage level and complaint you entered were not saved')).toBeDefined()
    expect(notSaved.textContent).toContain('The board still shows Tunde Boardone as: No triage level yet. To change it, open their record and select Triage.')
    expect(screen.getByRole('link', { name: 'Open their record' }).getAttribute('href')).toBe(`/provider/emergency-department/${ATTENDANCE}`)
    // The arrival notice is not a success tone when nothing new was saved.
    expect(screen.getByText('Tunde Boardone is already on the board.').closest('.hid-ehr-dept-notice')!.className).not.toContain('positive')
  })

  it('says nothing about triage when none was entered for a patient already on the board', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [SEARCH]: [searchAnswer],
      [ARRIVE]: [() => json({ outcome: 'already_on_board', attendance: card({ triageLevel: 2 }), replayed: false })],
    })
    await openStaffApp('/provider/emergency-department/new')
    await chooseFromSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Tunde Boardone is already on the board.')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/were not saved/)).toBeNull()
  })
})
