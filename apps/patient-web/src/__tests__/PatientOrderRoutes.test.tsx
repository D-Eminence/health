import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { PatientNotification, PatientOrderRoute } from '../api'
import { AccessPage, NotificationsPage } from '../routes/Portal'
import { json, problem, profile, renderPortal } from './portalHarness'

/**
 * The patient's orders sent to other facilities (Novu, P4c, SPEC-FINAL §5, §13.4): GET /ehr/me/order-routes lists each
 * test request or prescription a clinician sent to a laboratory or pharmacy at another facility, the clinician's
 * confirmation that the patient agreed, as confirmed (names filled), and exactly what that facility receives; Stop
 * (POST …/withdraw) is the patient's only action, while the order waits to be accepted. The inbox names each notice
 * in words. hid-system main, and a Novu before P4c, answer 404: the card is not shown, and a main-v1 build asks nothing.
 */
const ROUTE = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
const sent = (overrides: Partial<PatientOrderRoute> = {}): PatientOrderRoute => ({ id: ROUTE, reference: '9C1B2D3E', kind: 'lab_request',
  version: 1, effectiveState: 'sent', receivingFacility: { id: 'f1', name: 'Yaba Diagnostics', available: true },
  createdAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z', acceptedAt: null, completedAt: null, endedAt: null,
  endedKind: null, declineReason: null, acceptLocked: false, resendAllowed: false, orderingFacilityName: 'General Hospital',
  receivingFacilityName: 'Yaba Diagnostics', receivingRegisteredAddress: '12 Herbert Macaulay Way, Yaba, Lagos',
  content: { testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: 'Haemoglobin', priority: 'urgent', specimenTypeCode: 'Venous blood',
    clinicalInformation: 'Tired for two weeks', requestedAt: '2026-10-20T08:55:00.000Z', ordererName: 'Dr Ade Okon',
    ordererLicenceBody: 'MDCN', ordererLicenceNumber: 'MDCN/12345' },
  attestationTextVersion: 'order-route-lab-attestation-v1',
  attestationText: 'I confirm that {patient} agreed that {orderingFacility} sends this test request to {receivingFacility}.',
  attestedByName: 'Dr Ade Okon', actions: ['withdraw'], ...overrides })

let routes: unknown
let stopped: Response | null

function handler(path: string, method: string) {
  if (path === '/identity/me/access-requests') return json([])
  if (path === '/identity/me/access-history') return json({ items: [] })
  if (path === '/identity/me') return json(profile)
  if (path === '/ehr/me/order-routes') return routes instanceof Response ? routes : json(routes)
  if (method === 'POST' && path === `/ehr/me/order-routes/${ROUTE}/withdraw`) return stopped ?? json({ route: sent({ effectiveState: 'withdrawn', endedKind: 'patient', actions: [] }) })
  return problem(404, 'NOT_FOUND', 'Not here')
}

beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  routes = { items: [sent()] }
  stopped = null
})
afterEach(() => { vi.unstubAllEnvs() })

describe('orders sent to other facilities, on Access and consent', () => {
  it('lists each order with its clinician’s confirmation, filled, and exactly what the other facility will receive', async () => {
    renderPortal(<AccessPage />, handler)
    const card = (await screen.findByRole('heading', { name: 'Orders sent to other facilities' })).closest('.patient-card') as HTMLElement
    const order = await within(card).findByText('Haemoglobin from General Hospital to Yaba Diagnostics: waiting for Yaba Diagnostics to accept it')
    const item = order.closest('li')!
    expect(within(item).getByText('Yaba Diagnostics’s registered office: 12 Herbert Macaulay Way, Yaba, Lagos')).toBeTruthy()
    expect(within(item).getByText(/^Sent on 20 Oct 2026 · Reference 9C1B2D3E$/)).toBeTruthy()
    expect(within(item).getByText('Dr Ade Okon at General Hospital confirmed that you agreed:')).toBeTruthy()
    await waitFor(() => expect(within(item).getByText('I confirm that Ada Example agreed that General Hospital sends this test request to Yaba Diagnostics.')).toBeTruthy())
    expect(within(item).getByText('What Yaba Diagnostics will receive')).toBeTruthy()
    const fields = [...item.querySelectorAll('dt')].map(term => `${term.textContent}: ${term.nextElementSibling?.textContent}`)
    expect(fields).toEqual([
      'Test: Haemoglobin, LOINC 718-7', 'Priority: urgent', 'Specimen type: Venous blood',
      'What your clinician wrote about it: Tired for two weeks', 'Requested on: 20 Oct 2026',
      'Requested by: Dr Ade Okon, licence MDCN MDCN/12345',
      'You: your name, sex, date of birth and the last 4 characters of your Health ID, once it accepts',
    ])
    expect(within(item).getByText('If you did not agree to this, stop it now: Yaba Diagnostics has not accepted it yet.')).toBeTruthy()
  })

  it('stops an order still waiting, the patient’s only action', async () => {
    let calls = 0
    const { sent: requests } = renderPortal(<AccessPage />, (path, method) => {
      if (path === '/ehr/me/order-routes' && method === 'GET') {
        calls += 1
        return json({ items: [calls === 1 ? sent() : sent({ effectiveState: 'withdrawn', endedKind: 'patient', actions: [], version: 2 })] })
      }
      return handler(path, method)
    })
    fireEvent.click(await screen.findByRole('button', { name: /^Stop it/ }))
    expect(await screen.findByText('Stopped. Yaba Diagnostics can no longer accept it, and General Hospital is told.')).toBeTruthy()
    expect(await screen.findByText('Haemoglobin from General Hospital to Yaba Diagnostics: you stopped it')).toBeTruthy()
    expect(requests.filter(request => request.method === 'POST')).toEqual([
      { path: `/ehr/me/order-routes/${ROUTE}/withdraw`, method: 'POST', body: { expectedVersion: 1 } }])
    expect(screen.queryByRole('button', { name: /^Stop it/ })).toBeNull()
  })

  it('says a Stop came too late, and reads the list again', async () => {
    stopped = problem(409, 'ORDER_ROUTE_NOT_PENDING', 'Not pending')
    renderPortal(<AccessPage />, handler)
    fireEvent.click(await screen.findByRole('button', { name: /^Stop it/ }))
    expect(await screen.findByText('It can no longer be stopped here: Yaba Diagnostics has accepted it, or it has already ended. The list has been refreshed.')).toBeTruthy()
  })

  it('offers no Stop once the other facility has accepted it, and says whom to contact', async () => {
    routes = { items: [sent({ effectiveState: 'accepted', acceptedAt: '2026-10-21T10:00:00.000Z', actions: [] }),
      sent({ id: 'f0000000-0000-4000-8000-000000000002', kind: 'prescription', effectiveState: 'completed', actions: ['withdraw'],
        content: { medicationDisplay: 'Amoxicillin 500 mg capsules', doseQuantity: '500', doseUnit: 'mg', routeCode: 'oral',
          frequency: 'Three times daily', instructions: 'Take with food', startsOn: '2026-10-20', endsOn: '2026-10-27',
          prescribedAt: '2026-10-20T08:55:00.000Z', ordererName: 'Dr Ade Okon', ordererLicenceBody: null, ordererLicenceNumber: null } })] }
    renderPortal(<AccessPage />, handler)
    expect(await screen.findByText('Haemoglobin from General Hospital to Yaba Diagnostics: accepted by Yaba Diagnostics')).toBeTruthy()
    expect(screen.getByText('Amoxicillin 500 mg capsules from General Hospital to Yaba Diagnostics: dispensed by Yaba Diagnostics')).toBeTruthy()
    expect(screen.getAllByText('Yaba Diagnostics has accepted it. To stop it, contact General Hospital, who can cancel the order.')).toHaveLength(2)
    expect(screen.getAllByText('What Yaba Diagnostics received')).toHaveLength(2)
    const prescription = screen.getByText(/^Amoxicillin 500 mg capsules from/).closest('li')!
    expect([...prescription.querySelectorAll('dt')].map(term => `${term.textContent}: ${term.nextElementSibling?.textContent}`)).toEqual([
      'Medicine: Amoxicillin 500 mg capsules', 'Dose: 500 mg', 'How it is taken: oral', 'How often: Three times daily',
      'Instructions: Take with food', 'Starts: 20 Oct 2026', 'Ends: 27 Oct 2026', 'Prescribed on: 20 Oct 2026', 'Prescribed by: Dr Ade Okon',
      'You: your name, sex, date of birth and the last 4 characters of your Health ID, once it accepts'])
    expect(screen.queryByRole('button', { name: /^Stop it/ })).toBeNull()
  })

  it('lists an order marked entered in error by reference, state and facilities only, with no content, confirmation or Stop', async () => {
    // As C5 answers it (P4c review): content holds only the reference, no attestation or attesting clinician, no actions.
    const blank = { testCodeSystem: null, testCode: null, testDisplay: null, priority: null, specimenTypeCode: null,
      clinicalInformation: null, requestedAt: null, ordererName: null, ordererLicenceBody: null, ordererLicenceNumber: null }
    routes = { items: [
      sent({ effectiveState: 'withdrawn', endedKind: 'entered_in_error', endedAt: '2026-10-21T08:00:00.000Z', content: blank,
        attestationText: null, attestedByName: null, actions: [], enteredInError: true }),
      sent({ id: 'f0000000-0000-4000-8000-000000000003', reference: '0A1B2C3D', effectiveState: 'completed',
        acceptedAt: '2026-10-21T10:00:00.000Z', completedAt: '2026-10-22T10:00:00.000Z', content: blank,
        attestationText: null, attestedByName: null, actions: ['withdraw'], enteredInError: true }),
      sent({ id: 'f0000000-0000-4000-8000-000000000005', reference: '5A6B7C8D', content: blank, attestationText: null,
        attestedByName: null, enteredInError: true }),
      sent({ id: 'f0000000-0000-4000-8000-000000000004', reference: '4E5F6A7B' })] }
    renderPortal(<AccessPage />, handler)
    const withdrawn = (await screen.findByText('A test request from General Hospital to Yaba Diagnostics: withdrawn because your clinician changed the order')).closest('li')!
    expect(within(withdrawn).getByText(/^Sent on 20 Oct 2026 · Reference 9C1B2D3E$/)).toBeTruthy()
    expect(within(withdrawn).getByText('General Hospital marked this order as entered in error, so what it contained is no longer shown here.')).toBeTruthy()
    expect(within(withdrawn).getByText('If you have questions about it, contact General Hospital.')).toBeTruthy()
    expect(within(withdrawn).queryByText(/received your name/)).toBeNull()
    expect(withdrawn.querySelectorAll('dt')).toHaveLength(0)
    expect(withdrawn.textContent).not.toMatch(/confirmed that you agreed|will receive|stop it now/)
    // Accepted before it was marked so: the patient is told what that facility received about them.
    const completed = screen.getByText(/^Sent on 20 Oct 2026 · Reference 0A1B2C3D$/).closest('li')!
    expect(within(completed).getByText(/^A test request from General Hospital to Yaba Diagnostics: Yaba Diagnostics sent the result back/)).toBeTruthy()
    expect(within(completed).getByText(/^Yaba Diagnostics had accepted it, so it received your name, sex, date of birth and the last\s+4 characters of your Health ID\.$/)).toBeTruthy()
    expect(completed.textContent).not.toMatch(/has accepted it\. To stop it/)
    // Never a Stop for an order in error, whatever actions say; the other order keeps its content and Stop.
    expect(screen.getAllByRole('button', { name: /^Stop it/ })).toHaveLength(1)
    expect(screen.getByText('Haemoglobin from General Hospital to Yaba Diagnostics: waiting for Yaba Diagnostics to accept it')).toBeTruthy()
  })

  it('is not shown where the backend has no such list (404)', async () => {
    routes = problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/ehr/me/order-routes')
    renderPortal(<AccessPage />, handler)
    expect(await screen.findByRole('heading', { name: 'Access history' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Loading your orders…')).toBeNull())
    expect(screen.queryByRole('heading', { name: 'Orders sent to other facilities' })).toBeNull()
  })

  it('is not asked for on a main-v1 build', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    const { sent: requests } = renderPortal(<AccessPage />, handler)
    expect(await screen.findByRole('heading', { name: 'Access history' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Orders sent to other facilities' })).toBeNull()
    expect(requests.some(request => request.path.startsWith('/ehr/me/order-routes'))).toBe(false)
  })
})

describe('notices about orders sent to other facilities', () => {
  const notice = (code: string, kind: string, id = '1'): PatientNotification => ({ id: `80000000-0000-4000-8000-00000000000${id}`,
    notificationCode: code, resourceType: 'order-route', resourceId: ROUTE,
    metadata: { routeId: ROUTE, kind, orderingFacilityName: 'General Hospital', receivingFacilityName: 'Yaba Diagnostics' },
    readAt: null, createdAt: '2026-10-20T09:00:00Z' })

  it('names each notice in words, with the facility and what was sent, never its code', async () => {
    renderPortal(<NotificationsPage />, () => json([
      notice('ORDER_ROUTE_SENT', 'lab_request', '1'), notice('ORDER_ROUTE_WITHDRAWN', 'prescription', '2'),
      notice('ORDER_ROUTE_ACCEPTED', 'lab_request', '3'), notice('ORDER_ROUTE_DECLINED', 'prescription', '4'),
      notice('ORDER_ROUTE_ACCEPT_LOCKED', 'lab_request', '5'), notice('ORDER_ROUTE_CANCELLED', 'other', '6'),
    ]))
    const items = await screen.findAllByRole('listitem')
    expect(items.map(item => item.querySelector('strong')?.textContent)).toEqual([
      'Your test request was sent to Yaba Diagnostics: see it in Access and consent',
      'Your prescription to Yaba Diagnostics was withdrawn',
      'Yaba Diagnostics accepted your test request',
      'Yaba Diagnostics could not take your prescription',
      'Yaba Diagnostics could not confirm it was you, so it can’t take your test request. Ask your clinician to send it again',
      'Your test request or prescription at Yaba Diagnostics was cancelled',
    ])
    expect(within(items[0]!).getByText(/^Order to another facility · /)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/ORDER.ROUTE|order-route|9c1b2d3e/)
  })
})
