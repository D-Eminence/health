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
export const stepHeading = () => screen.getByRole('heading', { level: 2, name: /^(Your account|Facility details|Regulatory identity|Platform setup|Agreements)$/ })

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

/** Every step filled as an administrator would, ending on Agreements. */
export async function toReview({ entry, type, product }: { entry?: string; type?: string; product?: string } = {}) {
  await toForm(entry)
  fireEvent.change(textbox('Full name'), { target: { value: `  ${NAME} ` } })
  fireEvent.change(textbox('Email'), { target: { value: ' Admin@Demo-Hospital.Example.TEST ' } })
  next()
  await step('Facility details')
  if (type) fireEvent.change(combobox('Facility type'), { target: { value: type } })
  next()
  await step('Regulatory identity')
  fireEvent.change(textbox('CAC registration number'), { target: { value: 'rc 123 456' } })
  next()
  await step('Platform setup')
  if (product) fireEvent.change(combobox('Product to start with'), { target: { value: product } })
  next()
  await step('Agreements')
}

export const AGREEMENT_LABELS = ['I have read the Terms of Service', 'I have read the Privacy Policy',
  'I acknowledge data protection and patient consent responsibilities', 'I am authorised to register this facility']

export function agreeToAll() {
  for (const name of AGREEMENT_LABELS) {
    const box = screen.getByRole('checkbox', { name }) as HTMLInputElement
    if (!box.checked) fireEvent.click(box)
  }
}

export const submitButton = () => button('Submit facility for verification')

/** Ticks the agreements, submits, and accepts in the dialog. */
export async function submitRegistration() {
  agreeToAll()
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
