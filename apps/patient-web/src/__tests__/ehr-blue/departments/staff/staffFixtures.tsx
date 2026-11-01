import { screen } from '@testing-library/react'
import { expect, vi } from 'vitest'
import { toast } from '@hid/ui'
import type { FacilityStaff, FacilityStaffInvitation, FacilityStaffMember } from '../../../../staff/api'
import { StaffAccess } from '../../../../ehr-blue/departments/staff/StaffAccess'
import { DEMO_HOSPITAL_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * Fictional staff of "Demo Hospital", a facility that signed itself up, for the Staff & access page's tests. Each test
 * file mocks the staff session, the staff API and the backend contract itself (vi.mock is hoisted per file).
 */

export const ATTESTATION = 'I confirm that {name} works at {facility} and, for a clinical role, that I have seen their current '
  + 'practising licence with the number entered above. Health ID records this confirmation with my name, and Health ID '
  + 'support may check it.'

/** Demo Hospital as the session reports it; `selfService` null for a governed facility (no self sign-up). */
export function hospital(selfService: FakeFacility['selfService'] | null = { review: 'reviewed', organizationType: 'hospital' },
  permissions = ['workforce.manage']): FakeFacility {
  return fakeFacility(permissions, { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', roles: ['org_admin'],
    ...(selfService ? { selfService } : {}) })
}

export const administrator = (overrides: Partial<FacilityStaffMember> = {}): FacilityStaffMember => ({
  membershipId: 'membership-demo-admin', version: 2, accountId: 'account-demo-admin', name: 'Demo Administrator',
  email: 'demo.admin@example.test', roles: ['org_admin', 'doctor'], isAdministrator: true, isSelf: true,
  joinedAt: '2026-10-20T09:00:00.000Z',
  licence: { body: 'MDCN', numberHint: '2345', vouchedBy: null, vouchedAt: '2026-10-24T12:00:00.000Z', method: 'platform_review' },
  ...overrides,
})

export const nurse = (overrides: Partial<FacilityStaffMember> = {}): FacilityStaffMember => ({
  membershipId: 'membership-demo-nurse', version: 3, accountId: 'account-demo-nurse', name: 'Demo Nurse',
  email: 'demo.nurse@example.test', roles: ['nurse'], isAdministrator: false, isSelf: false, joinedAt: '2026-10-25T09:00:00.000Z',
  licence: { body: 'NMCN', numberHint: '8765', vouchedBy: 'Demo Administrator', vouchedAt: '2026-10-25T08:00:00.000Z',
    method: 'facility_attestation' },
  ...overrides,
})

export const invitation = (overrides: Partial<FacilityStaffInvitation> = {}): FacilityStaffInvitation => ({
  invitationId: 'invitation-demo-1', version: 1, reference: 'DEMO0001', name: 'Demo Doctor', email: 'demo.doctor@example.test',
  roleCode: 'doctor', licence: { body: 'MDCN', numberHint: '0777' }, status: 'pending', invitedBy: 'Demo Administrator',
  createdAt: '2026-10-25T09:30:00.000Z', lastSentAt: '2026-10-25T09:30:00.000Z', expiresAt: '2026-11-06T09:30:00.000Z',
  sendCount: 1, deliveryOutcome: 'accepted', resendAvailableAt: null,
  ...overrides,
})

export const staff = (overrides: Partial<FacilityStaff> = {}, facility: Partial<FacilityStaff['facility']> = {}): FacilityStaff => ({
  facility: { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', organizationType: 'hospital', reviewState: 'reviewed',
    firstThirtyDaysEndAt: null, invitationsOpen: true, deliveryPaused: false, ...facility },
  canInvite: true,
  limits: { pendingInvitations: 1, pendingLimit: 100, invitationsToday: 2, invitationsPerDay: 30, emailsToday: 3, emailsPerDay: 60 },
  inviteOptions: { roles: [{ code: 'doctor', licenceBody: 'MDCN' }, { code: 'nurse', licenceBody: 'NMCN' },
    { code: 'lab', licenceBody: 'MLSCN' }, { code: 'pharmacist', licenceBody: 'PCN' }, { code: 'receptionist', licenceBody: null }],
    attestation: { version: 'facility-staff-attestation-v1', text: ATTESTATION } },
  administratorLicence: null,
  administratorLicenceBodies: ['MDCN', 'NMCN'],
  members: [administrator(), nurse()],
  invitations: [invitation()],
  ...overrides,
})

/** Before Health ID support's check: the administrator alone, nothing to invite. */
export const pending = (overrides: Partial<FacilityStaff> = {}) => staff({ canInvite: false, members: [administrator({
  roles: ['org_admin_awaiting_review'], licence: null })], invitations: [], ...overrides }, { reviewState: 'pending' })

/** Spies on every toast the page could raise, letting them through. */
export function watchToasts() {
  return { success: vi.spyOn(toast, 'success'), warning: vi.spyOn(toast, 'warning'), info: vi.spyOn(toast, 'info'),
    error: vi.spyOn(toast, 'error'), show: vi.spyOn(toast, 'show') }
}

/**
 * The design's toast contract (UI-PATTERNS.md): generic copy only, never a name, an email, a licence number or another
 * identifier, and no description carrying them.
 */
export function expectGenericToasts(toasts: ReturnType<typeof watchToasts>) {
  for (const spy of Object.values(toasts)) {
    for (const call of spy.mock.calls) {
      const said = JSON.stringify(call)
      expect(said).not.toMatch(/@|Demo|ending|DEMO0|HID-|membership-|invitation-demo/)
      expect(call.length).toBe(1)
    }
  }
}

/** The page's banner for a fact an action leaves (an email not delivered, consents ended). */
export function pageNotice(): string {
  return document.getElementById('ehr-staff-notice')?.textContent ?? ''
}

export function openPage() {
  return renderDept(<StaffAccess />)
}

/** The page's members list, once read. */
export async function memberRow(name: string): Promise<HTMLElement> {
  return (await screen.findByText(name, { selector: 'strong' })).closest('li') as HTMLElement
}
