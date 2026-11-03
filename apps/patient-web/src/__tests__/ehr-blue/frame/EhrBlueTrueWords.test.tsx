import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type * as StaffApi from '../../../staff/api'
import { staffApi } from '../../../staff/api'
import { BlueHome } from '../../../ehr-blue/home/BlueHome'
import { AttentionProvider } from '../../../ehr-blue/frame/attention'
import { RoleViewProvider } from '../../../ehr-blue/frame/roleView'
import { NotificationsButton } from '../../../ehr-blue/frame/TopBarParts'
import { ACKNOWLEDGE } from '../../../ehr-blue/clinical/emergency/BreakGlass'
import { SUMMARY_LEDE } from '../../../ehr-blue/clinical/emergency/EmergencySummary'
import { emergencyNotice } from '../../../ehr-blue/clinical/emergency/access'
import { WrongPatientForm } from '../../../staff/routes/WrongPatient'
import { REAL_FACILITY, facility } from './blueHarness'

/**
 * The audit's misleading words, put right: emergency access promises only what is true, access requests wait for the
 * patient, "All clear" only after a read that worked, and the wrong-patient form points to where "We can't complete
 * this order" really is. Every account, facility and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/api', async importOriginal => {
  const actual = await importOriginal<typeof StaffApi>()
  return { ...actual, staffApi: { ...actual.staffApi, listAccessRequests: vi.fn() } }
})
const staff = vi.hoisted(() => ({ facility: undefined as unknown }))
vi.mock('../../../staff/App', async importOriginal => ({
  ...await importOriginal<object>(),
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-demo-1', displayName: 'Demo Clinician', roles: [], permissions: [],
      facility: staff.facility, facilities: [staff.facility] }, expiresAt: '2026-11-30T12:00:00.000Z' } },
    activePatient: null, lock: null,
  }),
}))
afterEach(() => { vi.clearAllMocks() })

const WAITING = [{ accessRequestId: 'r1', patientId: 'p-0000aa11bb22', scope: 'read_records', purposeOfUse: 'direct-care',
  reason: 'Follow-up (fictional)', status: 'pending', requestedDurationMinutes: 60, requestedAt: '2026-10-29T09:00:00Z',
  approvedAt: null, deniedAt: null, deniedReason: null }] as unknown as Awaited<ReturnType<typeof staffApi.listAccessRequests>>

function home(permissions: readonly string[]) {
  const here = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', permissions)
  staff.facility = here
  render(<MemoryRouter><RoleViewProvider><AttentionProvider facilityId={here.id} permissions={here.permissions}>
    <BlueHome /><NotificationsButton />
  </AttentionProvider></RoleViewProvider></MemoryRouter>)
  return within(screen.getByRole('region', { name: 'Needs attention' }))
}

describe('emergency access says only what is true', () => {
  it('promises no review of each view: the patient is told, every opening is recorded, and access ends', () => {
    for (const words of [ACKNOWLEDGE, SUMMARY_LEDE, emergencyNotice(false), emergencyNotice(true)]) {
      expect(words).not.toMatch(/review/i)
    }
    expect(ACKNOWLEDGE).toBe('I understand the patient is told, every opening is recorded, and access ends after 30 minutes.')
    expect(emergencyNotice(false)).toContain('It ends by itself, and every opening is recorded.')
    expect(SUMMARY_LEDE).toMatch(/Every opening is recorded\.$/)
  })
})

describe('the emergency notice says what the summary really shows and who is really told', () => {
  it('names the role\'s limits, no vital signs and no files, and only verified contacts chosen to notify while alerts are on', () => {
    for (const words of [emergencyNotice(false), emergencyNotice(true)]) {
      expect(words).toContain('the diagnoses, prescriptions, lab tests and documents your role may read.')
      expect(words).toContain('It shows no vital signs and opens no files.')
    }
    expect(emergencyNotice(true)).toContain('While emergency-contact alerts are on, each verified emergency contact the patient has chosen to notify is told')
    expect(emergencyNotice(false)).not.toMatch(/emergency contact/)
  })
})

describe('Home and the bell: access requests wait for the patient', () => {
  const PERMISSIONS = ['identity.consent.write', 'identity.patient.read']

  it('says a waiting request waits for the patient, on Home and in the bell', async () => {
    vi.mocked(staffApi.listAccessRequests).mockResolvedValue(WAITING)
    const card = home(PERMISSIONS)
    expect(await card.findByText('Waiting for the patient to answer')).toBeDefined()
    expect(card.queryByText('All clear')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Review and send them on|Review them/)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 1 waiting' }))
    const drawer = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(await within(drawer).findByText('Waiting for the patient to answer')).toBeDefined()
  })

  it('says all clear once the requests were read and none waits', async () => {
    vi.mocked(staffApi.listAccessRequests).mockResolvedValue([])
    const card = home(PERMISSIONS)
    expect(await card.findByText('All clear')).toBeDefined()
    expect(card.getByText('No requests waiting, no patient open.')).toBeDefined()
  })

  it('does not say all clear while the requests are still being read', () => {
    vi.mocked(staffApi.listAccessRequests).mockReturnValue(new Promise(() => {}))
    const card = home(PERMISSIONS)
    expect(card.getByRole('status').textContent).toMatch(/^Loading what needs attention/)
    expect(card.queryByText('All clear')).toBeNull()
  })

  it('does not say all clear after the read failed', async () => {
    vi.mocked(staffApi.listAccessRequests).mockRejectedValue(new HidApiError(503, 'Unavailable', { code: 'UNAVAILABLE' }))
    const card = home(PERMISSIONS)
    expect(await card.findByText('Couldn’t load access requests')).toBeDefined()
    await waitFor(() => expect(card.queryByRole('status')).toBeNull())
    expect(card.queryByText('All clear')).toBeNull()
  })

  it('names only what it checked for a role that reads no requests', () => {
    const card = home(['identity.patient.read'])
    expect(card.getByText('All clear')).toBeDefined()
    expect(card.getByText('No patient open.')).toBeDefined()
    expect(staffApi.listAccessRequests).not.toHaveBeenCalled()
  })
})

describe('the wrong-patient form points to the button where it really is', () => {
  it('on the blue Laboratory and Pharmacy, sends the reader into the opened order', () => {
    render(<WrongPatientForm id="lab-accepted-route-1-wrong-patient" service="lab" facilityId={REAL_FACILITY}
      route={{ id: 'route-1', version: 1, reference: '9C1B2D3E' }} patient="Patient One" ordering="Demo Hospital"
      cannotComplete="panel-request" onEnded={() => {}} onStale={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('If you can’t complete it for another reason, don’t use this: close this, open the order from the '
      + 'work list below, and use “We can’t complete this order” inside it.')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/on its row/)
  })
})
