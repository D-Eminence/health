import { expect, it, vi } from 'vitest'
import { patientChatHost } from '../chatFeatures'

vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production', patientChatEnabled: true }) }))
it('offers production patient chat only on its approved patient portal host', () => {
  expect(patientChatHost('app.healthidentitydirectory.com')).toBe(true)
  for (const hostname of ['healthidentitydirectory.com', 'www.healthidentitydirectory.com',
    'staging.healthidentitydirectory.com', 'ehr.healthidentitydirectory.com', 'admin.healthidentitydirectory.com',
    'lab.healthidentitydirectory.com', 'app.healthidentitydirectory.com.evil.example', 'localhost']) {
    expect(patientChatHost(hostname)).toBe(false)
  }
})
