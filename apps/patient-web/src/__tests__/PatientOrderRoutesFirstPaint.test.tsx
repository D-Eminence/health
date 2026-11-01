import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { PatientOrderRoute } from '../api'
import { AccessPage } from '../routes/Portal'
import { json, press, problem, profile, renderPortal } from './portalHarness'
import { forgetLateCorrectionServed } from '../lateCorrectionServed'

/**
 * D17 (CL4): a list whose orders carry their deadline (`correctableUntil`) says Health ID support among whom to tell from
 * its own first paint, not only once the page has learned it after that paint. Learning is switched off here, so only the
 * list itself can say it.
 */
vi.mock('../lateCorrectionServed', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  learnLateCorrectionServed: () => undefined,
}))

const route: PatientOrderRoute = { id: '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e', reference: '9C1B2D3E', kind: 'prescription',
  version: 1, effectiveState: 'completed', receivingFacility: { id: 'f1', name: 'Yaba Diagnostics', available: true },
  createdAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z', acceptedAt: '2026-10-21T10:00:00.000Z',
  completedAt: '2026-10-22T10:00:00.000Z', endedAt: '2026-10-23T10:00:00.000Z', endedKind: 'support', declineReason: null,
  acceptLocked: false, resendAllowed: false, orderingFacilityName: 'General Hospital', receivingFacilityName: 'Yaba Diagnostics',
  receivingRegisteredAddress: null, content: { reference: '9C1B2D3E' }, attestationTextVersion: 'order-route-lab-attestation-v1',
  attestationText: null, attestedByName: null, actions: [], enteredInError: true,
  wrongPatient: { reportedAt: '2026-11-24T09:00:00.000Z', late: true }, correctableUntil: null }

function handler(path: string) {
  if (path === '/identity/me/access-requests') return json([])
  if (path === '/identity/me/access-history') return json({ items: [] })
  if (path === '/identity/me') return json(profile)
  if (path === '/ehr/me/order-routes') return json({ items: [route] })
  return problem(404, 'NOT_FOUND', 'Not here')
}

beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1'); forgetLateCorrectionServed() })
afterEach(() => { vi.unstubAllEnvs(); forgetLateCorrectionServed() })

it('names Health ID support from the list’s own deadline, before the page has learned it (CL4)', async () => {
  renderPortal(<AccessPage />, handler)
  // Listed on the "Who has access" tab.
  await press(within(screen.getByRole('navigation', { name: 'Access' })).getByRole('button', { name: /^Who has access/ }))
  expect(await screen.findByText('If you did collect this medicine at Yaba Diagnostics, or someone collected it for you, tell '
    + 'General Hospital and Health ID support before you get another prescription.')).toBeTruthy()
})
