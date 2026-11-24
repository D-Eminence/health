import { expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BlueProviderEnrollment } from '../../../ehr-blue/signup/BlueProviderEnrollment'

/**
 * What the blue registration's tests share. Each test file mocks, before any import (vi.mock is hoisted):
 * - '../../../staff/api' with { providerEnrollmentApi: api, staffApi: {} }, `api` a vi.hoisted set of vi.fn();
 * - '../../../staff/clinicianApplicationApi' (the footer's clinician entry asks whether intake is open);
 * - '../../../staff/env' with signupFakes.tsx's ENVIRONMENT (support's address is fictional);
 * - '../../../Turnstile' with signupFakes.tsx's FakeTurnstile.
 * Every person, facility and address here is fictional.
 */

export const SUPPORT = 'support@example.test'
export const NAME = 'Demo Administrator'
export const EMAIL = 'admin@demo-hospital.example.test'

export function open(entry = '/provider/enroll') {
  return render(<MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/provider/enroll" element={<BlueProviderEnrollment />} />
    <Route path="/provider" element={<h1>Provider workspace</h1>} />
    <Route path="/provider/sign-in" element={<h1>Provider sign-in</h1>} />
  </Routes></MemoryRouter>)
}

export const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
export const combobox = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement
export const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
export const stepHeading = () => screen.getByRole('heading', { level: 2, name: /^(Your account|Facility details|Regulatory identity|Platform setup|Check and send)$/ })

export async function step(name: string) {
  return screen.findByRole('heading', { level: 2, name })
}

/** Waits for step `name`, and checks focus is on its heading. */
export async function expectFocusOnStep(name: string) {
  const heading = await step(name)
  expect(document.activeElement).toBe(heading)
}

export function next() {
  fireEvent.click(button('Continue'))
}

/** The registration, open at Your account. */
export async function toForm(entry?: string) {
  open(entry)
  await step('Your account')
}

const type = (label: string, value: string) => fireEvent.change(textbox(label), { target: { value } })
const choose = (label: string, value: string) => fireEvent.change(combobox(label), { target: { value } })

/** Step 1's fields besides the name and email (hid-system 0114): the applicant's phone and role. */
export function fillAccountExtras() {
  type('Your phone', '0803 123 4567')
  choose('Role at the facility', 'owner')
}

/** Step 2's facility details (hid-system 0114), every one required. */
export function fillFacilityDetails() {
  type('Facility name (the name people use)', '  Demo Hospital ')
  choose('Ownership', 'private')
  choose('Level of care', 'secondary')
  type('Address', '1 Example Road')
  type('City or town', 'Ikeja')
  choose('State', 'LA')
  type('Local government area', 'Ikeja')
  type('GPS latitude', '6.601234')
  type('GPS longitude', '3.351234')
  type('Facility phone', '+234 1 234 5678')
  type('Facility email', 'Desk@Demo-Hospital.Example.TEST')
  type('Bed count', '40')
  type('Operating hours', 'Mon-Sun 24 hours')
  choose('24-hour emergency', 'yes')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Laboratory' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'General Outpatient' }))
  type('Services offered', 'Outpatient care and laboratory tests')
}

/** Step 3's regulatory details besides the CAC number (hid-system 0114). */
export function fillRegulatory() {
  type('State Ministry of Health licence number', 'LA/SMOH/1234')
  choose('Does the facility have a national facility registry ID?', 'no')
  type('Medical Director’s full name', 'Dr Demo Director')
  type('Medical Director’s MDCN number', 'mdcn/12345')
  choose('Is the facility accredited by the NHIA?', 'yes')
  type('NHIA accreditation number', 'NHIA-1234')
}

/** Step 4's questions besides the product (hid-system 0114). */
export function fillPlatform() {
  type('Expected number of staff', '25')
  choose('Will you bring records from an older system?', 'no')
  choose('Do you need to exchange records with other systems?', 'yes')
}

/** What the fills above send with the start, as Identity takes it (hid-system docs/INTERFACE_CONTRACT.md section 43.2). */
export const COLLECTED = {
  administratorRole: 'owner',
  administratorPhone: '+2348031234567',
  facilityProfile: {
    tradingName: 'Demo Hospital', ownership: 'private', careLevel: 'secondary', addressLine: '1 Example Road', city: 'Ikeja',
    stateCode: 'LA', lga: 'Ikeja', gpsLatitude: 6.601234, gpsLongitude: 3.351234, phone: '+23412345678',
    email: 'desk@demo-hospital.example.test', bedCount: 40, operatingHours: 'Mon-Sun 24 hours', emergency24h: true,
    departments: ['general_outpatient', 'laboratory'], servicesOffered: 'Outpatient care and laboratory tests',
    smohLicenceNumber: 'LA/SMOH/1234', hasRegistryId: false, registryId: null, hasNhiaAccreditation: true,
    nhiaAccreditationNumber: 'NHIA-1234', medicalDirectorName: 'Dr Demo Director', medicalDirectorMdcn: 'MDCN/12345',
    expectedStaff: 25, migratingRecords: false, needsInteroperability: true,
  },
} as const

/** Every step filled as an administrator would, ending on Check and send. */
export async function toReview({ entry, type: facilityType, product }: { entry?: string; type?: string; product?: string } = {}) {
  await toForm(entry)
  fireEvent.change(textbox('Full name'), { target: { value: `  ${NAME} ` } })
  fireEvent.change(textbox('Email'), { target: { value: ' Admin@Demo-Hospital.Example.TEST ' } })
  fillAccountExtras()
  next()
  await step('Facility details')
  if (facilityType) fireEvent.change(combobox('Facility type'), { target: { value: facilityType } })
  fillFacilityDetails()
  next()
  await step('Regulatory identity')
  fireEvent.change(textbox('CAC registration number'), { target: { value: 'rc 123 456' } })
  fillRegulatory()
  next()
  await step('Platform setup')
  if (product) fireEvent.change(combobox('Product to start with'), { target: { value: product } })
  fillPlatform()
  next()
  await step('Check and send')
}

export const submitButton = () => button('Submit facility for verification')

/** Submits, and accepts in the dialog (there is no agreement box to tick: Health ID cannot record one yet). */
export async function submitRegistration() {
  fireEvent.click(submitButton())
  const dialog = await screen.findByRole('alertdialog', { name: 'Submit this registration?' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and submit' }))
}

/** Through the "Registration submitted" screen to the code. */
export async function toCode() {
  await toReview()
  await submitRegistration()
  await screen.findByRole('heading', { level: 1, name: 'Facility registration submitted' })
  fireEvent.click(button('Continue to verification'))
  await screen.findByRole('heading', { level: 1, name: 'Enter your verification code' })
}

export async function verifyWith(code = '123456') {
  fireEvent.change(textbox('Verification code'), { target: { value: code } })
  fireEvent.click(button('Verify code'))
}

/** Through the code to the password step. */
export async function toPassword() {
  await toCode()
  await verifyWith()
  await screen.findByRole('heading', { level: 1, name: 'Create your provider account' })
}

export function choosePassword(password = 'a-long-enough-password', confirm = password) {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } })
  fireEvent.click(button('Create provider account'))
}

/**
 * The portal's other tabs, as BroadcastChannel would connect them; `posted` is what this tab told them (as
 * staff/routes/ProviderEnrollment.test.tsx checks it).
 */
export class TabChannel extends EventTarget {
  static posted: Array<{ name: string; message: unknown }> = []
  constructor(readonly name: string) { super() }
  postMessage(message: unknown) { TabChannel.posted.push({ name: this.name, message }) }
  close() { /* nothing to release */ }
}
export const TOLD = { name: 'hid-session-change', message: 'changed' }

/** A request's answer, settled from the test. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

// A request answered outside act, as a fetch's answer arrives, renders in one task and would run its effects in a later
// one: the way to tell a focus moved in a layout effect from one moved later (as focusWhenShown explains).
const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
export function answer(settle: () => void) {
  environment.IS_REACT_ACT_ENVIRONMENT = false
  settle()
}
export function actAgain() {
  environment.IS_REACT_ACT_ENVIRONMENT = undefined
}
