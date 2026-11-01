import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { PatientNotification, PatientOrderRoute } from '../api'
import { AccessPage, NotificationsPage } from '../routes/Portal'
import { json, press, problem, profile, renderPortal, type Handler } from './portalHarness'
import { forgetLateCorrectionServed } from '../lateCorrectionServed'

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
  forgetLateCorrectionServed()
})
afterEach(() => { vi.unstubAllEnvs(); forgetLateCorrectionServed() })

const TITLE = 'Tests and prescriptions sent elsewhere'
/** Access & sharing, on its "Who has access" tab, where the orders sent elsewhere are listed. */
async function whoHasAccess(answer: Handler) {
  const view = renderPortal(<AccessPage />, answer)
  await press(within(screen.getByRole('navigation', { name: 'Access' })).getByRole('button', { name: /^Who has access/ }))
  return view
}

describe('orders sent to other facilities, on Access and consent', () => {
  it('lists each order with its clinician’s confirmation, filled, and exactly what the other facility will receive', async () => {
    await whoHasAccess(handler)
    const card = await screen.findByRole('region', { name: TITLE })
    const order = await within(card).findByText('Haemoglobin from General Hospital to Yaba Diagnostics: waiting for Yaba Diagnostics to accept it')
    const item = order.closest('li')!
    expect(within(item).getByText('Yaba Diagnostics’s registered office: 12 Herbert Macaulay Way, Yaba, Lagos')).toBeTruthy()
    expect(within(item).getByText(/^Sent on 20 Oct 2026 · Reference 9C1B2D3E$/)).toBeTruthy()
    expect(within(item).getByText('Dr Ade Okon at General Hospital confirmed that you agreed:')).toBeTruthy()
    await waitFor(() => expect(within(item).getByText('I confirm that Ada Example agreed that General Hospital sends this test request to Yaba Diagnostics.')).toBeTruthy())
    expect(within(item).getByText('What Yaba Diagnostics will receive')).toBeTruthy()
    const fields = [...item.querySelectorAll('dt')].map(term => `${term.textContent}: ${term.nextElementSibling?.textContent}`)
    expect(fields).toEqual([
      'Test: Haemoglobin, LOINC 718-7', 'Priority: urgent', 'Sample type: Venous blood',
      'Your doctor’s note: Tired for two weeks', 'Requested on: 20 Oct 2026',
      'Requested by: Dr Ade Okon, licence MDCN MDCN/12345',
      'You: your name, sex, date of birth and the last 4 characters of your Health ID, once it accepts',
    ])
    expect(within(item).getByText('If you didn’t agree to this, stop it now, before Yaba Diagnostics accepts it.')).toBeTruthy()
  })

  it('stops an order still waiting, the patient’s only action', async () => {
    let calls = 0
    const { sent: requests } = await whoHasAccess((path, method) => {
      if (path === '/ehr/me/order-routes' && method === 'GET') {
        calls += 1
        return json({ items: [calls === 1 ? sent() : sent({ effectiveState: 'withdrawn', endedKind: 'patient', actions: [], version: 2 })] })
      }
      return handler(path, method)
    })
    fireEvent.click(await screen.findByRole('button', { name: /^Stop it/ }))
    expect(await screen.findByText('Stopped. Yaba Diagnostics can no longer accept it, and General Hospital has been told.')).toBeTruthy()
    expect(await screen.findByText('Haemoglobin from General Hospital to Yaba Diagnostics: you stopped it')).toBeTruthy()
    expect(requests.filter(request => request.method === 'POST')).toEqual([
      { path: `/ehr/me/order-routes/${ROUTE}/withdraw`, method: 'POST', body: { expectedVersion: 1 } }])
    expect(screen.queryByRole('button', { name: /^Stop it/ })).toBeNull()
  })

  it('says a Stop came too late, and reads the list again', async () => {
    stopped = problem(409, 'ORDER_ROUTE_NOT_PENDING', 'Not pending')
    await whoHasAccess(handler)
    fireEvent.click(await screen.findByRole('button', { name: /^Stop it/ }))
    expect(await screen.findByText('It can’t be stopped now. Yaba Diagnostics has accepted it, or it has already ended. The list below is up to date.')).toBeTruthy()
  })

  it('offers no Stop once the other facility has accepted it, and says whom to contact', async () => {
    routes = { items: [sent({ effectiveState: 'accepted', acceptedAt: '2026-10-21T10:00:00.000Z', actions: [] }),
      sent({ id: 'f0000000-0000-4000-8000-000000000002', kind: 'prescription', effectiveState: 'completed', actions: ['withdraw'],
        acceptedAt: '2026-10-21T10:00:00.000Z', completedAt: '2026-10-22T10:00:00.000Z',
        content: { medicationDisplay: 'Amoxicillin 500 mg capsules', doseQuantity: '500', doseUnit: 'mg', routeCode: 'oral',
          frequency: 'Three times daily', instructions: 'Take with food', startsOn: '2026-10-20', endsOn: '2026-10-27',
          prescribedAt: '2026-10-20T08:55:00.000Z', ordererName: 'Dr Ade Okon', ordererLicenceBody: null, ordererLicenceNumber: null } })] }
    await whoHasAccess(handler)
    expect(await screen.findByText('Haemoglobin from General Hospital to Yaba Diagnostics: accepted by Yaba Diagnostics')).toBeTruthy()
    expect(screen.getByText('Amoxicillin 500 mg capsules from General Hospital to Yaba Diagnostics: dispensed by Yaba Diagnostics')).toBeTruthy()
    // "To stop it" is said while it is accepted only (item 3, B5); the check that it was them, while it may still be worked.
    expect(screen.getAllByText('Yaba Diagnostics has accepted it. To stop it, contact General Hospital.')).toHaveLength(1)
    expect(screen.getByText('If you haven’t been to Yaba Diagnostics for this test, tell Yaba Diagnostics or Health ID support straight away.')).toBeTruthy()
    expect(screen.getByText('If you haven’t been to Yaba Diagnostics for this medicine, and no one collected it for you, tell Yaba '
      + 'Diagnostics or Health ID support straight away.')).toBeTruthy()
    expect(screen.getAllByText('What Yaba Diagnostics received')).toHaveLength(2)
    const prescription = screen.getByText(/^Amoxicillin 500 mg capsules from/).closest('li')!
    expect([...prescription.querySelectorAll('dt')].map(term => `${term.textContent}: ${term.nextElementSibling?.textContent}`)).toEqual([
      'Medicine: Amoxicillin 500 mg capsules', 'Dose: 500 mg', 'How to take it: oral', 'How often: Three times daily',
      'Instructions: Take with food', 'Starts: 20 Oct 2026', 'Ends: 27 Oct 2026', 'Prescribed on: 20 Oct 2026', 'Prescribed by: Dr Ade Okon',
      'You: your name, sex, date of birth and the last 4 characters of your Health ID'])
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
    await whoHasAccess(handler)
    const withdrawn = (await screen.findByText('A test request from General Hospital to Yaba Diagnostics: withdrawn because your doctor changed the order')).closest('li')!
    expect(within(withdrawn).getByText(/^Sent on 20 Oct 2026 · Reference 9C1B2D3E$/)).toBeTruthy()
    expect(within(withdrawn).getByText('General Hospital marked this order as a mistake, so its details are no longer shown.')).toBeTruthy()
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
    await whoHasAccess(handler)
    expect(await screen.findByRole('heading', { name: 'No one has access now' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading your orders' })).toBeNull())
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
  })

  it('is not asked for on a main-v1 build', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    const { sent: requests } = await whoHasAccess(handler)
    expect(await screen.findByRole('heading', { name: 'No one has access now' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
    expect(requests.some(request => request.path.startsWith('/ehr/me/order-routes'))).toBe(false)
  })
})

/**
 * Item 3 (owner decisions D8, D13; SPEC-FINAL §8.3, §9.4): an order the receiving facility ended because it accepted it for
 * someone who was not the patient. The order is kept in full; the words say what the facility reported, what it had
 * received and can no longer see, what was withdrawn once something had come back, and what to do. While a facility may
 * still be working on an order, the patient is asked to say if they have not been there (C1).
 */
describe('an order the receiving facility reports it accepted for someone else', () => {
  const ended = (overrides: Partial<PatientOrderRoute> = {}) => sent({ effectiveState: 'cancelled', endedKind: 'wrong_patient',
    acceptedAt: '2026-10-21T10:00:00.000Z', endedAt: '2026-10-21T11:00:00.000Z', actions: [], ...overrides })
  const item = async (title: string) => (await screen.findByText(title)).closest('li') as HTMLElement
  const paragraphs = (element: HTMLElement) => [...element.querySelectorAll('p')].map(line => line.textContent)

  it('says what the laboratory reported, what it had received, and what to do, with no Stop and no “To stop it”', async () => {
    routes = { items: [ended()] }
    await whoHasAccess(handler)
    const order = await item('Haemoglobin from General Hospital to Yaba Diagnostics: ended: Yaba Diagnostics reports it accepted it for someone who was not you')
    expect(within(order).getByText('What Yaba Diagnostics received')).toBeTruthy()
    expect(within(order).getByText('Tired for two weeks')).toBeTruthy()
    expect(paragraphs(order).slice(-4)).toEqual([
      'Yaba Diagnostics told Health ID that the person it accepted this test request for was not you, so it ended it on 21 Oct 2026. '
        + 'It had received your name, sex, date of birth, the last 4 characters of your Health ID and the details above. It can no '
        + 'longer see them through this order.',
      'If you did give a sample at Yaba Diagnostics for this test, tell General Hospital.',
      'If you still need this test, contact General Hospital. Your doctor can send a new order.',
      'If you didn’t give anyone your Health ID or date of birth and think someone used them, contact Health ID support.'])
    expect(order.textContent).not.toMatch(/marked as not yours|To stop it|haven’t been to/)
    expect(within(order).queryByRole('button', { name: /^Stop it/ })).toBeNull()
  })

  it('says a returned result is marked as not theirs, and a returned dispensing cancelled, only once something had come back', async () => {
    routes = { items: [
      ended({ effectiveState: 'completed', completedAt: '2026-10-22T10:00:00.000Z', endedAt: '2026-10-23T10:00:00.000Z' }),
      ended({ id: 'f0000000-0000-4000-8000-000000000002', kind: 'prescription', effectiveState: 'completed',
        completedAt: '2026-10-22T10:00:00.000Z', endedAt: '2026-10-23T10:00:00.000Z',
        content: { medicationDisplay: 'Amoxicillin 500 mg capsules', ordererName: 'Dr Ade Okon' } })] }
    await whoHasAccess(handler)
    const test = await item('Haemoglobin from General Hospital to Yaba Diagnostics: ended: Yaba Diagnostics reports it accepted it for someone who was not you')
    expect(within(test).getByText('A result it recorded on this order belongs to that other person. It is marked as not yours and no '
      + 'longer shows in your health record. Both places keep it, marked, in their own records.')).toBeTruthy()
    const medicine = await item('Amoxicillin 500 mg capsules from General Hospital to Yaba Diagnostics: ended: Yaba Diagnostics reports it accepted it for someone who was not you')
    expect(paragraphs(medicine).slice(-5)).toEqual([
      'Yaba Diagnostics told Health ID that the person it accepted this prescription for was not you, so it ended it on 23 Oct 2026. '
        + 'It had received your name, sex, date of birth, the last 4 characters of your Health ID and the details above. It can no '
        + 'longer see them through this order.',
      'It recorded the medicine as given to that other person. That record has been cancelled.',
      'If you did collect this medicine at Yaba Diagnostics, or someone collected it for you, tell General Hospital before you get another prescription.',
      'If you still need this medicine, contact General Hospital. Your doctor can send a new order.',
      'If you didn’t give anyone your Health ID or date of birth and think someone used them, contact Health ID support.'])
  })

  it('keeps an order also marked entered in error redacted, saying only what the facility had received', async () => {
    routes = { items: [ended({ enteredInError: true, attestationText: null, attestedByName: null, content: { reference: '9C1B2D3E' } })] }
    await whoHasAccess(handler)
    const order = await item('A test request from General Hospital to Yaba Diagnostics: ended: Yaba Diagnostics reports it accepted it for someone who was not you')
    // After its title, the receiving facility's office and when it was sent.
    expect(paragraphs(order).slice(1, 3)).toEqual(['Yaba Diagnostics’s registered office: 12 Herbert Macaulay Way, Yaba, Lagos',
      'Sent on 20 Oct 2026 · Reference 9C1B2D3E'])
    expect(paragraphs(order).slice(3)).toEqual([
      'General Hospital marked this order as a mistake, so its details are no longer shown.',
      'Yaba Diagnostics told Health ID that the person it accepted this test request for was not you, so it ended it on 21 Oct 2026. '
        + 'It had received your name, sex, date of birth and the last 4 characters of your Health ID. It can no longer see them '
        + 'through this order.',
      'If you have questions about it, contact General Hospital.'])
    expect(order.querySelector('dl')).toBeNull()
  })

  it('no longer reads a completed order whose access ended another way as a plain return', async () => {
    const done = { effectiveState: 'completed', acceptedAt: '2026-10-21T10:00:00.000Z', completedAt: '2026-10-22T10:00:00.000Z',
      endedAt: '2026-10-23T10:00:00.000Z', actions: [] }
    routes = { items: [sent({ ...done, endedKind: 'support' }),
      sent({ ...done, id: 'f0000000-0000-4000-8000-000000000002', endedKind: 'receiving_released' })] }
    await whoHasAccess(handler)
    expect(await screen.findByText('Haemoglobin from General Hospital to Yaba Diagnostics: Yaba Diagnostics sent the result back to '
      + 'General Hospital; Health ID support has since closed it')).toBeTruthy()
    expect(screen.getByText('Haemoglobin from General Hospital to Yaba Diagnostics: Yaba Diagnostics sent the result back to General '
      + 'Hospital; Yaba Diagnostics is no longer on Health ID')).toBeTruthy()
    // Neither may still be worked on: no "To stop it", and no check that the patient went there.
    expect(document.body.textContent).not.toMatch(/To stop it|haven’t been to/)
  })
})

describe('notices about orders sent to other facilities', () => {
  it('names the wrong-person notice with its own title (D8)', async () => {
    renderPortal(<NotificationsPage />, () => json([{ id: '80000000-0000-4000-8000-000000000009',
      notificationCode: 'ORDER_ROUTE_WRONG_PATIENT', resourceType: 'order-route', resourceId: ROUTE,
      metadata: { routeId: ROUTE, kind: 'prescription', orderingFacilityName: 'General Hospital', receivingFacilityName: 'Medplus Yaba' },
      readAt: null, createdAt: '2026-10-24T09:00:00Z' }]))
    const [item] = await screen.findAllByRole('listitem')
    expect(item!.querySelector('p')?.textContent).toBe('Medplus Yaba accepted your prescription for someone who was not you, and has ended it')
    expect(document.body.textContent).not.toMatch(/ORDER.ROUTE|WRONG.PATIENT/)
  })

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
    expect(items.map(item => item.querySelector('p')?.textContent)).toEqual([
      'Your test request was sent to Yaba Diagnostics. See it in Access & sharing',
      'Your prescription to Yaba Diagnostics was withdrawn',
      'Yaba Diagnostics accepted your test request',
      'Yaba Diagnostics couldn’t take your prescription',
      'Yaba Diagnostics couldn’t confirm it was you, so it can’t take your test request. Ask your doctor to send it again',
      'Your test request or prescription at Yaba Diagnostics was cancelled',
    ])
    expect(within(items[0]!).getByText(/^Test or prescription · /)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/ORDER.ROUTE|order-route|9c1b2d3e/)
  })
})

/**
 * D17 (hid-system 0090; SPEC-FINAL §9.3): a report the receiving facility made after the order had ended another way, and
 * the deadline until which it may still correct an order. The list carries `wrongPatient` and `correctableUntil` only from
 * a backend that serves it; without them every line stays as it was.
 */
describe('a late report, and until when the receiving facility can correct it (D17)', () => {
  const done = { effectiveState: 'completed', acceptedAt: '2026-10-21T10:00:00.000Z', completedAt: '2026-10-22T10:00:00.000Z', actions: [] }
  const late = { endedAt: '2026-10-23T10:00:00.000Z', endedKind: 'support', wrongPatient: { reportedAt: '2026-11-24T09:00:00.000Z', late: true },
    correctableUntil: null }
  const item = async (title: string | RegExp) => (await screen.findByText(title)).closest('li') as HTMLElement
  const paragraphs = (element: HTMLElement) => [...element.querySelectorAll('p')].map(line => line.textContent)

  it('says the ending, then the late report, and what was withdrawn, with support among whom to tell (CL4)', async () => {
    routes = { items: [sent({ ...done, ...late })] }
    await whoHasAccess(handler)
    const order = await item('Haemoglobin from General Hospital to Yaba Diagnostics: Yaba Diagnostics sent the result back to General '
      + 'Hospital; Health ID support has since closed it; Yaba Diagnostics has since reported it accepted it for someone who was not you')
    expect(within(order).getByText('What Yaba Diagnostics received')).toBeTruthy()
    expect(paragraphs(order).slice(-5)).toEqual([
      'Yaba Diagnostics told Health ID on 24 Nov 2026 that the person it accepted this test request for was not you. It had '
        + 'received your name, sex, date of birth, the last 4 characters of your Health ID and the details above.',
      'A result it recorded on this order belongs to that other person. It is marked as not yours and no longer shows in your '
        + 'health record. Both places keep it, marked, in their own records.',
      'If you did give a sample at Yaba Diagnostics for this test, tell General Hospital and Health ID support.',
      'If you still need this test, contact General Hospital. Your doctor can send a new order.',
      'If you didn’t give anyone your Health ID or date of birth and think someone used them, contact Health ID support.'])
    expect(order.textContent).not.toMatch(/haven’t been to|so it ended it on/)
  })

  it('tells the patient, when the order is also marked entered in error, only what names no content (CL7, CT9)', async () => {
    routes = { items: [sent({ ...done, ...late, kind: 'prescription', enteredInError: true, attestationText: null, attestedByName: null,
      content: { reference: '9C1B2D3E' } })] }
    await whoHasAccess(handler)
    const order = await item(/^A prescription from General Hospital to Yaba Diagnostics: dispensed by Yaba Diagnostics; Health ID support has since closed it; Yaba Diagnostics has since reported/)
    // After its title, the receiving facility's office and when it was sent.
    expect(paragraphs(order).slice(1, 3)).toEqual(['Yaba Diagnostics’s registered office: 12 Herbert Macaulay Way, Yaba, Lagos',
      'Sent on 20 Oct 2026 · Reference 9C1B2D3E'])
    expect(paragraphs(order).slice(3)).toEqual([
      'General Hospital marked this order as a mistake, so its details are no longer shown.',
      'Yaba Diagnostics told Health ID on 24 Nov 2026 that the person it accepted this prescription for was not you. It had '
        + 'received your name, sex, date of birth and the last 4 characters of your Health ID.',
      'It recorded the medicine as given to that other person. That record has been cancelled.',
      'If you did collect this medicine at Yaba Diagnostics, or someone collected it for you, tell General Hospital and Health ID '
        + 'support before you get another prescription.',
      'If you still need this medicine, contact General Hospital. Your doctor can send a new order.',
      'If you have questions about it, contact General Hospital.'])
    expect(order.textContent).not.toMatch(/details above/)
    expect(order.querySelector('dl')).toBeNull()
  })

  it('says whom to tell, with the reference, until the date the facility can correct it, also after the order ended (CT5)', async () => {
    routes = { items: [
      sent({ ...done, effectiveState: 'accepted', completedAt: null, wrongPatient: null, correctableUntil: '2027-04-19T10:00:00.000Z' }),
      sent({ ...done, id: 'f0000000-0000-4000-8000-000000000002', kind: 'prescription', endedAt: '2026-10-23T10:00:00.000Z',
        endedKind: 'support', wrongPatient: null, correctableUntil: '2027-04-19T10:00:00.000Z',
        content: { medicationDisplay: 'Amoxicillin 500 mg capsules', ordererName: 'Dr Ade Okon' } }),
      sent({ ...done, id: 'f0000000-0000-4000-8000-000000000003', reference: null, wrongPatient: null, correctableUntil: null,
        content: { testDisplay: 'Lipid profile', ordererName: 'Dr Ade Okon' } }),
    ] }
    await whoHasAccess(handler)
    const test = await item('Haemoglobin from General Hospital to Yaba Diagnostics: accepted by Yaba Diagnostics')
    expect(within(test).getByText('If you haven’t been to Yaba Diagnostics for this test, tell Yaba Diagnostics, General Hospital or '
      + 'Health ID support straight away, with the reference 9C1B2D3E. Yaba Diagnostics can correct it until 19 Apr 2027, 11:00.')).toBeTruthy()
    const medicine = await item(/^Amoxicillin 500 mg capsules from General Hospital/)
    expect(within(medicine).getByText('If you haven’t been to Yaba Diagnostics for this medicine, and no one collected it for you, '
      + 'tell Yaba Diagnostics, General Hospital or Health ID support straight away, with the reference 9C1B2D3E. Yaba Diagnostics '
      + 'can correct it until 19 Apr 2027, 11:00.')).toBeTruthy()
    // Past its date, with no report: tell the ordering facility.
    const past = await item(/^Lipid profile from General Hospital/)
    expect(within(past).getByText('If you haven’t been to Yaba Diagnostics for this test, tell General Hospital.')).toBeTruthy()
  })

  it('tells the patient to tell the ordering facility once the receiving facility was released, whatever date it carries (D17-3)', async () => {
    routes = { items: [sent({ ...done, endedAt: '2026-10-23T10:00:00.000Z', endedKind: 'receiving_released', wrongPatient: null,
      correctableUntil: '2027-04-19T10:00:00.000Z' })] }
    await whoHasAccess(handler)
    const test = await item(/^Haemoglobin from General Hospital to Yaba Diagnostics/)
    expect(within(test).getByText('If you haven’t been to Yaba Diagnostics for this test, tell General Hospital.')).toBeTruthy()
    expect(test.textContent).not.toMatch(/can correct it until/)
  })

  it('says the deadline in the entered-in-error branch too, and nothing of it against today’s answers', async () => {
    routes = { items: [
      sent({ ...done, endedAt: '2026-10-23T10:00:00.000Z', endedKind: 'entered_in_error', enteredInError: true, attestationText: null,
        attestedByName: null, content: { reference: '9C1B2D3E' }, wrongPatient: null, correctableUntil: '2027-04-19T10:00:00.000Z' }),
    ] }
    await whoHasAccess(handler)
    const order = await item(/^A test request from General Hospital to Yaba Diagnostics/)
    expect(within(order).getByText(/^If you haven’t been to Yaba Diagnostics for this test, tell Yaba Diagnostics, General Hospital or Health ID support straight away, with the reference 9C1B2D3E/)).toBeTruthy()
  })

  it('keeps every line as it was without the new fields', async () => {
    routes = { items: [sent({ ...done, endedAt: '2026-10-23T10:00:00.000Z', endedKind: 'support' }),
      sent({ ...done, id: 'f0000000-0000-4000-8000-000000000002', effectiveState: 'accepted', completedAt: null })] }
    await whoHasAccess(handler)
    await screen.findByText(/Health ID support has since closed it$/)
    expect(screen.getByText('If you haven’t been to Yaba Diagnostics for this test, tell Yaba Diagnostics or Health ID support straight away.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/can correct it until|has since reported|and Health ID support\./)
  })

  it('names the late notice with its own title', async () => {
    renderPortal(<NotificationsPage />, () => json([{ id: '80000000-0000-4000-8000-000000000010',
      notificationCode: 'ORDER_ROUTE_WRONG_PATIENT_CORRECTED', resourceType: 'order-route', resourceId: ROUTE,
      metadata: { routeId: ROUTE, kind: 'lab_request', orderingFacilityName: 'General Hospital', receivingFacilityName: 'Yaba Diagnostics' },
      readAt: null, createdAt: '2026-11-24T09:00:00Z' }]))
    const [entry] = await screen.findAllByRole('listitem')
    expect(entry!.querySelector('p')?.textContent).toBe('Yaba Diagnostics reports that it accepted your test request for someone who was not you')
    expect(document.body.textContent).not.toMatch(/ORDER.ROUTE|CORRECTED/)
  })
})

/**
 * D18 (hid-system 0091; SPEC-FINAL §9.3, D18-3, D18-4): an order the receiving facility accepted and couldn't complete.
 * The patient reads that it couldn't, never why, and to contact the clinic, once; after a later wrong-patient report the
 * state reads "ended at" it, and the report's paragraph says to contact the clinic. The inbox has its own title.
 */
describe('an order the receiving facility couldn’t complete (D18)', () => {
  const unable = { effectiveState: 'cancelled', acceptedAt: '2026-10-21T10:00:00.000Z', endedAt: '2026-10-23T10:00:00.000Z',
    endedKind: 'receiving_unable', actions: [], correctableUntil: '2027-04-19T10:00:00.000Z', wrongPatient: null }
  const AGAIN = 'If you still need this test, contact General Hospital. Your doctor can send a new order.'

  it('says the facility couldn’t complete it and to contact the clinic, never why, and keeps the “haven’t been” line', async () => {
    routes = { items: [sent(unable as Partial<PatientOrderRoute>)] }
    await whoHasAccess(handler)
    const item = (await screen.findByText('Haemoglobin from General Hospital to Yaba Diagnostics: Yaba Diagnostics couldn’t '
      + 'complete it')).closest('li') as HTMLElement
    const lines = [...item.querySelectorAll('p')].map(line => line.textContent)
    expect(lines.filter(line => line === AGAIN)).toHaveLength(1)
    expect(lines.at(-1)).toBe('If you haven’t been to Yaba Diagnostics for this test, tell Yaba Diagnostics, General Hospital or '
      + 'Health ID support straight away, with the reference 9C1B2D3E. Yaba Diagnostics can correct it until 19 Apr 2027, 11:00.')
    expect(item.textContent).not.toMatch(/run out|reason|stop it now|Stop it/)
  })

  it('says “medicine” for a prescription', async () => {
    routes = { items: [sent({ ...(unable as Partial<PatientOrderRoute>), kind: 'prescription',
      content: { medicationDisplay: 'Amoxicillin 500 mg capsules' } })] }
    await whoHasAccess(handler)
    const item = (await screen.findByText(/^Amoxicillin 500 mg capsules from General Hospital to Yaba Diagnostics: Yaba Diagnostics couldn’t complete it$/))
      .closest('li') as HTMLElement
    expect(within(item).getByText('If you still need this medicine, contact General Hospital. Your doctor can send a new order.')).toBeTruthy()
  })

  it('after a later report, reads “ended at” the facility, and says to contact the clinic exactly once', async () => {
    routes = { items: [sent({ ...(unable as Partial<PatientOrderRoute>), correctableUntil: null,
      wrongPatient: { reportedAt: '2026-10-25T09:00:00.000Z', late: true } } as Partial<PatientOrderRoute>)] }
    await whoHasAccess(handler)
    const item = (await screen.findByText('Haemoglobin from General Hospital to Yaba Diagnostics: ended at Yaba Diagnostics; Yaba '
      + 'Diagnostics has since reported it accepted it for someone who was not you')).closest('li') as HTMLElement
    expect([...item.querySelectorAll('p')].map(line => line.textContent).filter(line => line === AGAIN)).toHaveLength(1)
    expect(item.textContent).not.toMatch(/couldn’t complete/)
  })

  it('names its inbox notice with its own title, never the reason', async () => {
    renderPortal(<NotificationsPage />, () => json([
      { id: '80000000-0000-4000-8000-000000000001', notificationCode: 'ORDER_ROUTE_NOT_COMPLETED', resourceType: 'order-route',
        resourceId: ROUTE, metadata: { routeId: ROUTE, kind: 'lab_request', orderingFacilityName: 'General Hospital',
          receivingFacilityName: 'Yaba Diagnostics' }, readAt: null, createdAt: '2026-10-23T10:00:00Z' },
      { id: '80000000-0000-4000-8000-000000000002', notificationCode: 'ORDER_ROUTE_NOT_COMPLETED', resourceType: 'order-route',
        resourceId: ROUTE, metadata: { routeId: ROUTE, kind: 'prescription', orderingFacilityName: 'General Hospital',
          receivingFacilityName: 'Medplus Yaba' }, readAt: null, createdAt: '2026-10-23T10:00:00Z' },
    ]))
    const items = await screen.findAllByRole('listitem')
    expect(items.map(entry => entry.querySelector('p')?.textContent)).toEqual([
      'Yaba Diagnostics couldn’t complete your test request. See it in Access & sharing',
      'Medplus Yaba couldn’t complete your prescription. See it in Access & sharing'])
    expect(document.body.textContent).not.toMatch(/ORDER.ROUTE|NOT.COMPLETED/)
  })
})
