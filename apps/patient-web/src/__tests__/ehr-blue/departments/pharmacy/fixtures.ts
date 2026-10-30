import { screen, within } from '@testing-library/react'
import { expect } from 'vitest'
import type { PharmacyWorkItem, WorkItemOrderRoute } from '../../../../staff/api'

/**
 * Fictional work for the blue Pharmacy page's tests: "Patient One" (HID-ZDEMAAA2), prescriptions accepted at "Demo
 * Pharmacy", some sent by "Demo Hospital".
 */
export const READ = 'pharmacy.work-item.read'
export const CREATE = 'pharmacy.dispensing.create'
export const DISPENSING_READ = 'pharmacy.dispensing.read'
export const REVERSE = 'pharmacy.dispensing.reverse'
export const RECEIVE = 'pharmacy.order-route.receive'
export const ALL = [READ, CREATE, DISPENSING_READ, REVERSE]

export const PATIENT_A = '5f1c2e9a-7b44-4d0e-9a3f-0c2d4e6f8a10'
export const PATIENT_B = '8d3b6a21-1e5c-4f7a-b2d9-71c0e5a9b3c4'
export const PATIENT_C = 'c2a7f0d8-3b19-4c6e-8e45-9f1d2b7c6e58'
export const PATIENT_D = '3e9d1b70-6a2f-4c85-b1e4-5d7a0c9f2b36'

export const AMOXICILLIN = 'Amoxicillin 500 mg capsule'
export const METFORMIN = 'Metformin 850 mg tablet'
export const SALBUTAMOL = 'Salbutamol 100 microgram inhaler'
export const IBUPROFEN = 'Ibuprofen 400 mg tablet'

/** Accepted, not yet dispensed. */
export const accepted: PharmacyWorkItem = {
  id: 'a1b2c3d4-work-item-1', patientId: PATIENT_A, version: 3, acceptedAt: '2026-10-08T09:30:00.000Z',
  medication: { display: AMOXICILLIN }, doseQuantity: 1, doseUnit: 'capsule', frequency: 'Three times daily', routeCode: 'oral',
  instructions: 'Take with food.\nFinish the course.', dispensing: null,
}
/** Dispensed and still in effect. */
export const dispensed: PharmacyWorkItem = {
  id: 'b2c3d4e5-work-item-2', patientId: PATIENT_B, version: 7, acceptedAt: '2026-10-07T14:05:00.000Z',
  medication: { display: METFORMIN }, doseQuantity: 1, doseUnit: 'tablet', frequency: 'Twice daily with meals',
  dispensing: { id: 'dispensing-2', reversed: false },
}
/** Dispensed then reversed; no dose, frequency or route on the order. */
export const reversed: PharmacyWorkItem = {
  id: 'c3d4e5f6-work-item-3', patientId: PATIENT_C, version: 9, acceptedAt: '2026-10-06T08:00:00.000Z',
  medication: { display: SALBUTAMOL }, doseQuantity: null, doseUnit: null, dispensing: { id: 'dispensing-3', reversed: true },
}
/** Accepted at the second facility. */
export const otherFacilityItem: PharmacyWorkItem = {
  id: 'd4e5f6a7-work-item-4', patientId: PATIENT_D, version: 2, acceptedAt: '2026-10-08T11:15:00.000Z',
  medication: { display: IBUPROFEN }, doseQuantity: 1, doseUnit: 'tablet', frequency: 'Every eight hours as needed', dispensing: null,
}
/** The accepted item once its dispensing is recorded. */
export const nowDispensed: PharmacyWorkItem = { ...accepted, version: 4, dispensing: { id: 'dispensing-9', reversed: false } }

export const PATIENT = { fullName: 'Patient One', sex: 'female', dateOfBirth: '1990-01-01', healthIdLast4: 'AAA2' }
export const PATIENT_CARD = 'Patient One, female, born 1 Jan 1990, Health ID ending AAA2'
export const ROUTE_ID = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'

/** The route of a prescription Demo Hospital sent here, as the work list carries it. */
export function routeCard(overrides: Partial<WorkItemOrderRoute> = {}): WorkItemOrderRoute {
  return { id: ROUTE_ID, reference: '9C1B2D3E', effectiveState: 'accepted', access: 'work', orderingFacilityName: 'Demo Hospital',
    ordererName: 'Dr Demo Prescriber', version: 3, endedKind: null, ...overrides }
}

/** A prescription Demo Hospital sent here and this pharmacy accepted for Patient One. */
export function routed(overrides: Partial<PharmacyWorkItem> = {}): PharmacyWorkItem {
  return { id: 'e5f6a7b8-routed-1', patientId: PATIENT_A, version: 1, acceptedAt: '2026-10-21T10:00:00.000Z',
    medication: { display: 'Amoxicillin 250 mg capsules' }, doseQuantity: 250, doseUnit: 'mg', routeCode: 'oral',
    frequency: 'Three times daily', instructions: null, dispensing: null, orderRoute: routeCard(), patient: PATIENT, ...overrides }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

/** Only the masked 6-character suffix of a patient's ID may reach the page, in text or attributes. */
export function expectNoFullPatientIds() {
  const markup = document.body.innerHTML
  for (const patientId of [PATIENT_A, PATIENT_B, PATIENT_C, PATIENT_D]) {
    expect(markup).not.toContain(patientId)
    expect(markup).not.toContain(patientId.replaceAll('-', ''))
    expect(markup).not.toContain(patientId.slice(0, 8))
    expect(markup).not.toContain(patientId.slice(-7))
  }
}

/** A list row, found by its record's name. */
export function row(name: string): HTMLElement {
  const link = screen.getByRole('button', { name })
  const tr = link.closest('tr')
  if (!tr) throw new Error(`No row for ${name}`)
  return tr
}

/** The open record's "Available actions" card. */
export function actionsCard(): HTMLElement {
  return screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
}

/** The open record's "Saved record" card. */
export function savedRecord(): HTMLElement {
  return screen.getByRole('heading', { name: 'Saved record' }).closest('section') as HTMLElement
}

/** What the record's status region says: mounted with the record, empty until something is recorded. */
export function recorded(): string {
  return within(actionsCard()).getByRole('status').textContent ?? ''
}

/** The error a refused field is described by, or null while it is not marked invalid. */
export function refusal(control: HTMLElement): string | null {
  if (control.getAttribute('aria-invalid') !== 'true') return null
  const ids = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id.endsWith('-error'))
  return ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

/** The open record's line under its title: its status badge, patient and when it was accepted. */
export function contextLine(): HTMLElement {
  const line = document.querySelector<HTMLElement>('.hid-ehr-dept-context')
  if (!line) throw new Error('No record is open')
  return line
}
