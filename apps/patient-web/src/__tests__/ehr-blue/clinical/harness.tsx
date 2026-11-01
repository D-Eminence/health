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
}

/** Demo Hospital, one of the sealed demo tenant's four facilities (ehr-blue/blueFacilities.ts). */
export const DEMO_HOSPITAL_ID = '98d00002-0000-4000-8000-000000000001'

export function staffValue(staff: StaffMock) {
  const roles = [...(staff.roles ?? ['doctor'])]
  return {
    state: {
      status: 'ready' as const,
      session: {
        actor: {
          id: 'staff-1',
          displayName: 'Demo Clinician',
          roles,
          permissions: staff.permissions,
          facilities: [],
          facility: { id: staff.facilityId ?? FACILITY_ID, membershipId: 'member-1', organizationId: 'org-1', name: FACILITY_NAME, roles, permissions: staff.permissions, isPrimary: true },
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
