import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OWN_FACILITY_REFUSED, OWN_FACILITY_TITLE, dropOfferedHealthId } from '../../../ehr-blue/clinical/consent/access'
import { PatientsWorkspace } from '../../../ehr-blue/clinical/patients/PatientsWorkspace'
import { OWN_FACILITY_LABEL, accessLabel } from '../../../ehr-blue/clinical/patients/PatientPage'
import { FACILITY_ID, PATIENT_HID, PATIENT_ID, allowedLookup, deniedLookup, labelled, renderPage } from './harness'

/**
 * Find a patient's Search by name (hid-system 0132, ID-3a) and "Open as this facility’s patient" (0131, ID-4). The
 * search sends the keys in the body and shows cards with no Health ID; a card opens through today's lookup. Every
 * patient, Health ID and matchRef here is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), closeGrant: vi.fn(), encounters: vi.fn(), verifyPin: vi.fn(), breakGlass: vi.fn(),
  sharedWithMe: vi.fn(), staffShareInvitations: vi.fn(), acceptShareInvitation: vi.fn(), reportedHealthProfile: vi.fn(),
  searchPatients: vi.fn(), openOwnFacilityPatient: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined, roles: undefined as string[] | undefined }))
const session = vi.hoisted(() => ({
  staffSessionGeneration: vi.fn(() => 5), untilStaffSessionReady: vi.fn(async (_sentIn: number) => {}),
  staffSessionSignal: vi.fn(() => new AbortController().signal),
}))

vi.mock('../../../staff/api', async () => ({
  staffApi: api,
  isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup,
  ACCESS_REQUEST_STATUSES: ['pending', 'approved', 'denied', 'revoked', 'expired'],
  ACCESS_OUTCOME_FILTERS: ['active', 'closed'],
}))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => session)

const DOCTOR = ['identity.patient.read', 'identity.consent.write', 'identity.consent.read', 'ehr.encounter.read', 'ehr.note.read',
  'identity.registration.write', 'identity.patient.open-own-facility', 'identity.patient-access-pin.verify']
const NOT_FOUND = new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' })
const NO_GRANT = new HidApiError(403, 'Forbidden', { code: 'ACCESS_DENIED' })
const MATCH_REF = `psr_${'A'.repeat(43)}`
const OTHER_REF = `psr_${'B'.repeat(43)}`
const CARD = {
  matchRef: MATCH_REF, matchRefExpiresAt: '2099-01-01T00:10:00.000Z', fullName: 'Ada Fictional', sex: 'female',
  dateOfBirth: '1990-04-12', healthIdLast4: 'AAA2', ninStatus: 'verified' as 'verified' | 'not_verified',
}
const OTHER_CARD = { ...CARD, matchRef: OTHER_REF, fullName: 'Ada Fictional-Two', healthIdLast4: 'QRS3', ninStatus: 'not_verified' as const }
const found = (...patients: typeof CARD[]) => ({ mode: 'standard', outcome: 'found', reach: 'everywhere', message: null, patients })
const OWN_FACILITY = {
  consentGrantId: 'grant-own', patientId: PATIENT_ID, status: 'active', expiresAt: '2026-11-24T10:00:00.000Z', existingGrant: false,
  authorization: { basis: 'own-facility', scope: 'write_records', purpose: 'direct-care' },
}

beforeEach(() => {
  vi.clearAllMocks()
  dropOfferedHealthId()
  staff.permissions = [...DOCTOR]
  staff.activePatient = null
  staff.facilityId = undefined
  staff.roles = undefined
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [], nextCursor: null })
  api.sharedWithMe.mockRejectedValue(NOT_FOUND)
  api.staffShareInvitations.mockRejectedValue(NOT_FOUND)
  api.reportedHealthProfile.mockResolvedValue(null)
  api.searchPatients.mockResolvedValue(found(CARD))
  api.openOwnFacilityPatient.mockResolvedValue(OWN_FACILITY)
})

function open() {
  return renderPage(<PatientsWorkspace />, 'patients')
}

const nameSearch = () => screen.getByRole('heading', { name: 'Search by name' }).closest('section') as HTMLElement
const field = (label: string) => within(nameSearch()).getByLabelText(labelled(label), { exact: false }) as HTMLInputElement

function fillAndSearch(keys: { first?: string; last?: string; born?: string; phone?: string; hid?: string }) {
  if (keys.first !== undefined) fireEvent.change(field('First name'), { target: { value: keys.first } })
  if (keys.last !== undefined) fireEvent.change(field('Last name'), { target: { value: keys.last } })
  if (keys.born !== undefined) fireEvent.change(field('Date of birth'), { target: { value: keys.born } })
  if (keys.phone !== undefined) fireEvent.change(within(nameSearch()).getByLabelText(/^Phone/), { target: { value: keys.phone } })
  if (keys.hid !== undefined) fireEvent.change(within(nameSearch()).getByLabelText(/^Health ID/), { target: { value: keys.hid } })
  fireEvent.click(within(nameSearch()).getByRole('button', { name: 'Search' }))
}

describe('Search by name on Find a patient', () => {
  it('is offered to a role that registers patients, and not to one that does not', () => {
    const { unmount } = open()
    expect(screen.getByRole('heading', { name: 'Search by name' })).toBeTruthy()
    unmount()
    staff.permissions = DOCTOR.filter(permission => permission !== 'identity.registration.write')
    open()
    expect(screen.queryByRole('heading', { name: 'Search by name' })).toBeNull()
  })

  it('sends the keys typed, at this facility, and shows each card: name, sex, date of birth, the last four and the NIN status', async () => {
    api.searchPatients.mockResolvedValue(found(CARD, OTHER_CARD))
    open()
    fillAndSearch({ first: ' Ada ', last: 'Fictional', born: '1990-04-12', phone: '0803 000 0001' })
    const list = await screen.findByRole('list', { name: 'Patients found' })
    expect(api.searchPatients).toHaveBeenCalledWith(FACILITY_ID, { firstName: ' Ada ', lastName: 'Fictional', dateOfBirth: '1990-04-12', phone: '0803 000 0001', healthId: undefined })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]!.textContent).toContain('Ada Fictional')
    expect(items[0]!.textContent).toContain('Female · Born 12 Apr 1990 · Health ID •••• AAA2')
    expect(items[0]!.textContent).toContain('NIN Verified')
    expect(items[1]!.textContent).toContain('NIN Not Verified')
    // Never a matchRef, a full Health ID or the word the contract forbids on screen.
    expect(nameSearch().textContent).not.toMatch(/psr_|unverified/i)
    expect(screen.getByText('2 patients match.')).toBeTruthy()
  })

  it('refuses an empty search, and a Health ID that is not whole, before sending', async () => {
    open()
    fillAndSearch({})
    expect(await screen.findByText('Enter their first name, last name and date of birth.')).toBeTruthy()
    fillAndSearch({ last: 'Fictional', hid: 'HID-ZDE' })
    expect(await within(nameSearch()).findByText(/Check the Health ID/)).toBeTruthy()
    expect(api.searchPatients).not.toHaveBeenCalled()
  })

  it('opens a card through today’s lookup with the Health ID the search was made with', async () => {
    open()
    fillAndSearch({ last: 'Fictional', hid: 'hid-zdemaaa2' })
    expect(api.searchPatients).toHaveBeenCalledWith(FACILITY_ID, expect.objectContaining({ lastName: 'Fictional', healthId: PATIENT_HID }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    await waitFor(() => expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care'))
    await waitFor(() => expect(staff.setActivePatient).toHaveBeenCalledWith({ hid: PATIENT_HID, lookup: allowedLookup, purpose: 'direct-care' }))
  })

  it('without a Health ID in the search, asks for the one on the patient’s card and checks its last four first', async () => {
    open()
    fillAndSearch({ first: 'Ada', last: 'Fictional', born: '1990-04-12' })
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    const hid = await screen.findByLabelText('Ada Fictional’s Health ID')
    expect(screen.getByText('Ask to see their Health ID card. It ends in AAA2.')).toBeTruthy()
    fireEvent.change(hid, { target: { value: 'HID-ZDEMQRS3' } })
    fireEvent.click(within(hid.closest('form')!).getByRole('button', { name: 'Open' }))
    expect(await screen.findByText('This Health ID doesn’t end in AAA2. Check it with the patient.')).toBeTruthy()
    expect(api.lookupPatient).not.toHaveBeenCalled()
    fireEvent.change(hid, { target: { value: PATIENT_HID } })
    fireEvent.click(within(hid.closest('form')!).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care'))
  })

  it('says why nobody was found, and offers registering them where the role may', async () => {
    api.searchPatients.mockResolvedValue({ mode: 'standard', outcome: 'no_match', reach: 'here', message: null, patients: [] })
    open()
    fillAndSearch({ last: 'Fictional', born: '1990-04-12' })
    expect(await screen.findByText('No patient of this facility matches. To search every facility, add the full name and date of birth.')).toBeTruthy()
    expect(within(nameSearch()).getByRole('link', { name: 'Register a new patient' }).getAttribute('href')).toBe('/provider/registration')
  })

  it('says a search that is too broad in plain words', async () => {
    api.searchPatients.mockRejectedValue(new HidApiError(400, 'Bad Request', { code: 'PATIENT_SEARCH_TOO_BROAD' }))
    open()
    fillAndSearch({ first: 'Ada' })
    expect(await screen.findByText(/^Add more details\. Search with the first name, last name and date of birth/)).toBeTruthy()
  })

  it('names no permission when the role is refused', async () => {
    api.searchPatients.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'PERMISSION_DENIED' }))
    open()
    fillAndSearch({ first: 'Ada', last: 'Fictional', born: '1990-04-12' })
    const said = await screen.findByText(/^Your role at this facility can’t search for patients by name\./)
    expect(said.textContent).not.toMatch(/permission/i)
  })
})

describe('Open as this facility’s patient', () => {
  async function refusedLookup() {
    api.lookupPatient.mockRejectedValueOnce(NO_GRANT)
    open()
    const hid = screen.getByRole('textbox', { name: labelled('Health ID') })
    fireEvent.change(hid, { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    return screen.findByRole('group', { name: 'Obtain access' })
  }

  it('is offered first to a doctor, nurse or clinician when a lookup is refused', async () => {
    const ways = await refusedLookup()
    const buttons = within(ways).getAllByRole('button')
    expect(buttons[0]!.textContent).toContain(OWN_FACILITY_TITLE)
    expect(buttons[0]!.textContent).toContain('If they registered here, or were seen here with their consent in the last 24 months.')
  })

  it('is not offered to a role that cannot take it', async () => {
    staff.permissions = DOCTOR.filter(permission => permission !== 'identity.patient.open-own-facility')
    const ways = await refusedLookup()
    expect(within(ways).queryByRole('button', { name: new RegExp(OWN_FACILITY_TITLE) })).toBeNull()
  })

  it('opens the patient for 24 hours with the Health ID in the body, then looks them up and opens their page', async () => {
    const ways = await refusedLookup()
    fireEvent.click(within(ways).getByRole('button', { name: new RegExp(OWN_FACILITY_TITLE) }))
    await waitFor(() => expect(api.openOwnFacilityPatient).toHaveBeenCalledWith(FACILITY_ID, { hid: PATIENT_HID }))
    await waitFor(() => expect(staff.setActivePatient).toHaveBeenCalledWith({ hid: PATIENT_HID, lookup: allowedLookup, purpose: 'direct-care', basis: 'own-facility' }))
    expect(api.lookupPatient).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
    expect(accessLabel(staff.activePatient as never)).toBe(OWN_FACILITY_LABEL)
    expect(OWN_FACILITY_LABEL).toBe('Opened as this facility’s patient')
  })

  it('keeps the other ways in, and says why, when the patient is not this facility’s own', async () => {
    api.openOwnFacilityPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'OWN_FACILITY_ACCESS_REFUSED' }))
    const ways = await refusedLookup()
    fireEvent.click(within(ways).getByRole('button', { name: new RegExp(OWN_FACILITY_TITLE) }))
    expect(await screen.findByText(OWN_FACILITY_REFUSED)).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Obtain access' })).getByRole('button', { name: /Use their Access PIN/ })).toBeTruthy()
    expect(staff.setActivePatient).not.toHaveBeenCalledWith(expect.objectContaining({ basis: 'own-facility' }))
  })

  it('says there is no such patient on 404 PATIENT_NOT_FOUND', async () => {
    api.openOwnFacilityPatient.mockRejectedValue(new HidApiError(404, 'Not Found', { code: 'PATIENT_NOT_FOUND' }))
    const ways = await refusedLookup()
    fireEvent.click(within(ways).getByRole('button', { name: new RegExp(OWN_FACILITY_TITLE) }))
    expect(await screen.findByText(`No patient has the Health ID ${PATIENT_HID}`)).toBeTruthy()
  })

  it('is offered after a search card’s lookup is refused, for that card’s patient', async () => {
    api.lookupPatient.mockResolvedValueOnce(deniedLookup)
    open()
    fillAndSearch({ last: 'Fictional', hid: PATIENT_HID })
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    const ways = await screen.findByRole('group', { name: 'Obtain access' })
    fireEvent.click(within(ways).getByRole('button', { name: new RegExp(OWN_FACILITY_TITLE) }))
    await waitFor(() => expect(api.openOwnFacilityPatient).toHaveBeenCalledWith(FACILITY_ID, { hid: PATIENT_HID }))
  })
})
