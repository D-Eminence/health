import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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

/** The frame mounts every page at `${BASE}/${path}/*`. */
export const BASE = '/ehr'

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
}

export function staffValue(staff: StaffMock) {
  return {
    state: {
      status: 'ready' as const,
      session: {
        actor: {
          id: 'staff-1',
          displayName: 'Demo Clinician',
          roles: ['doctor'],
          permissions: staff.permissions,
          facilities: [],
          facility: { id: FACILITY_ID, membershipId: 'member-1', organizationId: 'org-1', name: FACILITY_NAME, roles: ['doctor'], permissions: staff.permissions, isPrimary: true },
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

/** Renders one page as the frame mounts it, at `${BASE}/${path}${rest}`. */
export function renderPage(element: ReactElement, path: string, rest = '') {
  return render(
    <MemoryRouter initialEntries={[`${BASE}/${path}${rest}`]}>
      <Routes>
        <Route path={`${BASE}/${path}/*`} element={element} />
        <Route path="*" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** A RegExp for a field label, required or not ("Health ID" matches "Health ID *"). */
export function labelled(label: string) {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`)
}
