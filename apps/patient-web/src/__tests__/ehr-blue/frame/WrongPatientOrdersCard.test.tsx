import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as StaffApi from '../../../staff/api'
import { WrongPatientOrdersCard } from '../../../ehr-blue/home/liveCards'

/**
 * Home's "Orders accepted for the wrong person" card on its own. BlueHome shows it only where the site opens
 * Consultation, as classic does (`&& clinicalHere`, staff/routes/Dashboard.tsx:275; ProductSiteHome.test.tsx pins
 * that), so the card has no setting that hides the way to an order: every order it lists offers one. Every person,
 * facility and order here is fictional.
 */

const wrong = vi.hoisted(() => ({ answer: null as unknown, activePatient: null as unknown }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/api', async importOriginal => {
  const actual = await importOriginal<typeof StaffApi>()
  return { ...actual, orderRoutesApi: { ...actual.orderRoutesApi, sentWrongPatient: () => Promise.resolve(wrong.answer as never) } }
})
vi.mock('../../../staff/App', () => ({ useStaff: () => ({ activePatient: wrong.activePatient }) }))

const FACILITY = { id: 'f0000000-0000-4000-8000-0000000000e1', name: 'Riverside Clinic (fictional)' }
const PATIENT_ID = 'a0000000-0000-4000-8000-0000000000e1'
const PATIENT = 'Bola Ade (fictional)'
const OPEN_PATIENT = {
  hid: 'HID-ZDEMOBA1', purpose: 'direct-care',
  lookup: { patient: { patientId: PATIENT_ID, hid: 'HID-ZDEMOBA1', fullName: PATIENT, dateOfBirth: '1988-02-03', gender: 'female', version: 1 } },
}
const ANSWER = {
  windowDays: 30,
  others: { count: 0, references: [] },
  items: [{
    routeId: 'route-wrong-e1', kind: 'lab_request', reference: 'EF56GH78', endedAt: '2026-11-02T10:00:00.000Z', resultsWithdrawn: 0,
    dispensingReversed: false, patient: { name: PATIENT }, receivingFacility: { id: null, name: 'Valley Laboratory (fictional)' },
    link: { patientId: PATIENT_ID, encounterId: 'e0000000-0000-4000-8000-0000000000e1', kind: 'lab_request', orderId: 'o0000000-0000-4000-8000-0000000000e1' },
  }],
}

beforeEach(() => {
  wrong.answer = ANSWER
  wrong.activePatient = null
})

describe('Orders accepted for the wrong person: every order offers its way in', () => {
  it('takes no setting that hides the order, and opens it in Consultation when its patient is the one open', async () => {
    wrong.activePatient = OPEN_PATIENT
    // A product site never gets this card (BlueHome decides), so there is nothing for the card itself to switch off.
    // @ts-expect-error The card no longer takes `consultation`.
    render(<MemoryRouter><WrongPatientOrdersCard facilityId={FACILITY.id} facilityName={FACILITY.name} consultation={false} /></MemoryRouter>)
    const link = await screen.findByRole('link', { name: 'Open the lab request →' })
    expect(link.getAttribute('href')).toBe('/provider/clinical')
  })

  it('leads through Patients when another record is open, or none', async () => {
    // @ts-expect-error The card no longer takes `consultation`.
    render(<MemoryRouter><WrongPatientOrdersCard facilityId={FACILITY.id} facilityName={FACILITY.name} consultation={false} /></MemoryRouter>)
    const patients = await screen.findByRole('link', { name: 'Patients' })
    expect(patients.getAttribute('href')).toBe('/provider/patients')
    expect(patients.parentElement?.textContent).toBe(`To see it, open ${PATIENT}’s record from Patients, then the lab request with reference EF56GH78.`)
  })
})
