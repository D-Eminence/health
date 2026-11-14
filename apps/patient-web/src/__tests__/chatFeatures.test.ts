import { expect, it, vi } from 'vitest'
import { patientChatHost } from '../chatFeatures'

vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'staging', patientChatEnabled: true }) }))

it('rejects provider, admin and unrelated hosts even when the shared bundle enables patient chat', () => {
  expect(patientChatHost('staging.healthidentitydirectory.com')).toBe(true)
  for (const hostname of ['admin.staging.healthidentitydirectory.com', 'ehr.staging.healthidentitydirectory.com',
    'lab.staging.healthidentitydirectory.com', 'pharmacy.staging.healthidentitydirectory.com',
    'migrate.staging.healthidentitydirectory.com', 'outreach.staging.healthidentitydirectory.com',
    'www.staging.healthidentitydirectory.com', 'localhost', 'staging.healthidentitydirectory.com.evil.example']) {
    expect(patientChatHost(hostname)).toBe(false)
  }
})
