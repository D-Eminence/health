import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type PatientProfile } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { ProfilePage } from '../routes/Portal'

const profile: PatientProfile = {
  patientId: 'patient-1', hid: 'HID-ABC234', firstName: 'Ada', lastName: 'Example', fullName: 'Ada Example',
  dateOfBirth: '1991-03-04', gender: null, country: 'NG', state: null,
  assuranceState: 'LEGACY_MIGRATED', accessPinConfigured: false, version: 1,
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function renderProfile(fetchImpl: typeof fetch) {
  const client = createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web')
  const api = createPatientApi(client)
  render(<SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api)}><ProfilePage /></SessionContext.Provider>)
}

describe('patient self-service NIN verification', () => {
  it('sends only the NIN and clears it after a verified result', async () => {
    const requests: Array<{ path: string; body: unknown }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) as unknown : null })
      return path.endsWith('/verification/nin')
        ? json({ entityType: 'patient', verificationType: 'nin', provider: 'qoreid', state: 'verified',
          recordedAt: '2026-01-01T00:00:00.000Z' })
        : json(profile)
    }) as typeof fetch
    renderProfile(fetchImpl)

    const input = await screen.findByRole('textbox', { name: 'National Identification Number' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '12345678901' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify NIN' }))

    expect(await screen.findByText('NIN verification succeeded. Identity evidence was recorded.')).toBeTruthy()
    expect(input.value).toBe('')
    expect(requests.filter(request => request.path.endsWith('/verification/nin'))).toEqual([{
      path: '/api/v1/identity/me/verification/nin', body: { nin: '12345678901' },
    }])
  })

  it('keeps the entered NIN when the server requires identity review', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/verification/nin')
      ? json({ code: 'PATIENT_NIN_BINDING_CONFLICT', detail: 'This NIN requires identity review before it can be verified' }, 409)
      : json(profile)) as typeof fetch
    renderProfile(fetchImpl)

    const input = await screen.findByRole('textbox', { name: 'National Identification Number' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '12345678901' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify NIN' }))

    expect((await screen.findByRole('alert')).textContent).toContain('identity review')
    expect(input.value).toBe('12345678901')
  })

  it('does not offer the command for an ineligible assurance state', async () => {
    const fetchImpl = vi.fn(async () => json({ ...profile, assuranceState: 'MANUAL_REVIEW' })) as typeof fetch
    renderProfile(fetchImpl)

    await waitFor(() => expect(screen.getByText('This account is not eligible for self-service NIN verification. Identity review is required.')).toBeTruthy())
    expect(screen.queryByRole('textbox', { name: 'National Identification Number' })).toBeNull()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
