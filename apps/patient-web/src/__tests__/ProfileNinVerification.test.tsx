import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type { PatientProfile } from '../api'
import { ProfilePage } from '../routes/Portal'
import { json, profile, renderPortal } from './portalHarness'

/**
 * hid-system main f9dbaf0 answers the signed-in "Verify NIN"
 * (POST /identity/me/verification/nin) with 503 QOREID_PATIENT_NIN_BINDING_DISABLED
 * while QOREID_PATIENT_SELF_NIN_BINDING_ENABLED is off, its default, and
 * production refuses that flag. The card could only ask for a NIN to be refused,
 * so it is hidden until the owner decides P27 (Health-id alignment row 13).
 */
describe('the signed-in Verify NIN card (hidden until P27)', () => {
  it.each<PatientProfile['assuranceState']>(['NIN_VERIFIED', 'LEGACY_MIGRATED', 'MANUAL_REVIEW'])(
    'is not offered for an account at %s, and nothing is sent to the verification route', async assuranceState => {
      const { sent } = renderPortal(<ProfilePage />, () => json({ ...profile, assuranceState }))
      expect(await screen.findByRole('heading', { name: 'Bio-data' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'NIN verification' })).toBeNull()
      expect(screen.queryByRole('textbox', { name: 'National Identification Number' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Verify NIN' })).toBeNull()
      expect(sent.filter(request => request.path === '/identity/me/verification/nin')).toEqual([])
    })
})
