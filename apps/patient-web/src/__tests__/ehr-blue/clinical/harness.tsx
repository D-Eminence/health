import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { segmentOf } from '../../../ehr-blue/clinical/parts/segments'
import type { Mock } from 'vitest'

/**
 * Shared fixtures and render helpers for the blue EHR clinical page tests. Everything is fictional: the patient is
 * "Patient One", HID-ZDEMAAA2, at a demo facility. Each test file still declares its own vi.mock factories for
 * staff/api and staff/App (vi.mock is hoisted per file); these helpers build the values those factories return.
 */

export const FACILITY_ID = 'facility-demo-hospital'
export const FACILITY_NAME = 'Demo Hospital'
export const PATIENT_ID = 'a0000000-0000-4000-8000-000000000001'
export const PATIENT_HID = 'HID-ZDEMAAA2'
export const PATIENT_NAME = 'Patient One'
export const ENCOUNTER_ID = 'e0000000-0000-4000-8000-000000000001'

/** The blue EHR's base: the frame shows every page at `/provider/${segment}` and the addresses below it. */
export const BASE = '/provider'

export const allowedLookup = {
  patient: { patientId: PATIENT_ID, hid: PATIENT_HID, fullName: PATIENT_NAME, dateOfBirth: '1990-04-12', gender: 'female', version: 1 },
  authorization: { decision: 'allow' as const, consentGrantId: 'grant-1', expiresAt: '2026-10-30T12:00:00.000Z', breakGlass: false },
}

export const deniedLookup = { authorization: { decision: 'deny' as const } }

/** The `isAllowedPatientLookup` a staff/api mock factory must export alongside `staffApi`. */
export function isAllowedPatientLookup(lookup: { authorization: { decision: string }; patient?: unknown }) {
  return lookup.authorization.decision === 'allow' && !!lookup.patient
}

export type Purpose = 'direct-care' | 'emergency'

export function activePatient(purpose: Purpose = 'direct-care') {
  return { hid: PATIENT_HID, purpose, lookup: allowedLookup }
}

/**
 * What a mocked `useStaff()` returns. Mutate `staff.permissions` / `staff.activePatient` in a test; the mock reads
 * them on every render.
 */
export interface StaffMock {
  permissions: string[]
  activePatient: ReturnType<typeof activePatient> | null
  setActivePatient: Mock
  /** The working facility's id; FACILITY_ID unless a test needs another (a demo facility, for example). */
  facilityId?: string
  /**
   * The staff roles at the working facility; ['doctor'] unless a test needs others. Sample pages read them through the
   * design's role mapping (frame/sampleAccess.ts: doctor works as the design's Doctor, receptionist as Receptionist…).
   */
  roles?: readonly string[]
  /**
   * The signed-in member's ids as Identity's session sends them, when a test needs them told apart (see SIGNED_IN).
   * Unset: id 'staff-1', no account id, membership 'member-1'.
   */
  signedIn?: SignedIn
}

/**
 * A signed-in member as Identity's staff session describes them (identity-api current-staff-context toActor): the actor's
 * `id` is the sign-in subject, never the account id; `accountId` is what EHR writes as a record's createdBy; the
 * membership at the working facility is what it writes as createdByMembershipId. `accountId` is left out to stand for
 * a session without one.
 */
export interface SignedIn {
  readonly subject: string
  readonly accountId?: string
  readonly sessionId: string
  readonly membershipId: string
}

/** Fictional ids, every one different, shaped as production's (an invited member's subject is "staff-invitation:<account id>"). */
export const SIGNED_IN: SignedIn = {
  subject: 'staff-invitation:7c1e4a2b-3d5f-4e6a-8b9c-0d1e2f3a4b5c',
  accountId: '7c1e4a2b-3d5f-4e6a-8b9c-0d1e2f3a4b5c',
  sessionId: '0f6b2d8e-1a3c-4e5f-9a7b-8c9d0e1f2a3b',
  membershipId: '5d2e8f1a-6b3c-4d7e-8f9a-1b2c3d4e5f60',
}

/** Another member of the same facility: wrote the record, is not the one signed in. */
export const COLLEAGUE = { accountId: '3e9a7c5b-1d2f-4a6b-8c0d-9e8f7a6b5c4d', membershipId: '6a1b9c8d-7e6f-4a5b-9c3d-2e1f0a9b8c7d' }

/** Demo Hospital, one of the sealed demo tenant's four facilities (ehr-blue/blueFacilities.ts). */
export const DEMO_HOSPITAL_ID = '98d00002-0000-4000-8000-000000000001'

export function staffValue(staff: StaffMock) {
  const roles = [...(staff.roles ?? ['doctor'])]
  return {
    state: {
      status: 'ready' as const,
      session: {
        actor: {
          id: staff.signedIn?.subject ?? 'staff-1',
          ...(staff.signedIn ? { subject: staff.signedIn.subject, sessionId: staff.signedIn.sessionId } : {}),
          ...(staff.signedIn?.accountId === undefined ? {} : { accountId: staff.signedIn.accountId }),
          displayName: 'Demo Clinician',
          roles,
          permissions: staff.permissions,
          facilities: [],
          facility: {
            id: staff.facilityId ?? FACILITY_ID, membershipId: staff.signedIn?.membershipId ?? 'member-1', organizationId: 'org-1', name: FACILITY_NAME,
            roles, permissions: staff.permissions, isPrimary: true,
          },
        },
      },
    },
    lock: null,
    activePatient: staff.activePatient,
    setActivePatient: staff.setActivePatient,
  }
}

/** Shows where the app went: other workspaces render this instead of a page. */
function Elsewhere() {
  const location = useLocation()
  return <p data-testid="elsewhere">{location.pathname}</p>
}

/**
 * Renders one workspace at `${BASE}/${segment}${rest}`, where `segment` is the workspace's address segment
 * (consult is /provider/clinical, consent /provider/requests).
 */
export function renderPage(element: ReactElement, path: string, rest = '') {
  const segment = segmentOf(path)
  return render(
    <MemoryRouter initialEntries={[`${BASE}/${segment}${rest}`]}>
      <Routes>
        <Route path={`${BASE}/${segment}/*`} element={element} />
        <Route path="*" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** A RegExp for a field label, required or not ("Health ID" matches "Health ID *"). */
export function labelled(label: string) {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`)
}

/** The sticky patient banner every chart page shows (kasuwa PatientBanner): name, Health ID and access. */
export function patientBanner(name = PATIENT_NAME): HTMLElement {
  return document.querySelector(`section[aria-label="Patient: ${name}"]`) as HTMLElement
}
