import { expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
/** Each step's one heading, the page's h1: the question it asks. */
export const STEPS = {
  account: 'Your name and email',
  type: 'What kind of facility is it?',
  cac: 'Your CAC number',
  product: 'Which Health ID do you need?',
  review: 'Check and send',
} as const
export const stepHeading = () => screen.getByRole('heading', { level: 1, name: new RegExp(`^(${Object.values(STEPS)
  .map(name => name.replace('?', '\\?')).join('|')})$`) })

export async function step(name: string) {
  return screen.findByRole('heading', { level: 1, name })
}

/** A choice on the facility type or product step: a radio button named by its option. */
export const choice = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement

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
  await step(STEPS.account)
}

/** Every step filled as an administrator would, ending on Check and send. */
export async function toReview({ entry, type, product }: { entry?: string; type?: string; product?: string } = {}) {
  await toForm(entry)
  fireEvent.change(textbox('Full name'), { target: { value: `  ${NAME} ` } })
  fireEvent.change(textbox('Email'), { target: { value: ' Admin@Demo-Hospital.Example.TEST ' } })
  next()
  await step(STEPS.type)
  if (type) fireEvent.click(choice(TYPE_NAMES[type]!))
  next()
  await step(STEPS.cac)
  fireEvent.change(textbox('CAC number'), { target: { value: 'rc 123 456' } })
  next()
  // A type with one product (a laboratory, a pharmacy) is not asked which: the review comes next.
  if (!type || !ONE_PRODUCT.has(type)) {
    await step(STEPS.product)
    if (product) fireEvent.click(choice(PRODUCT_NAMES[product]!))
    next()
  }
  await step(STEPS.review)
}

export const TYPE_NAMES: Readonly<Record<string, string>> = { hospital: 'Hospital', clinic: 'Clinic', laboratory: 'Laboratory',
  pharmacy: 'Pharmacy', other: 'Other healthcare provider' }
export const PRODUCT_NAMES: Readonly<Record<string, string>> = { ehr: 'Health ID EHR', laboratory: 'Health ID Laboratory',
  pharmacy: 'Health ID Pharmacy', migrate: 'Health ID Migrate' }
const ONE_PRODUCT = new Set(['laboratory', 'pharmacy'])

/** The facility agreement's one box, before Identity has named the facility. */
export const AGREEMENT_LABEL = 'I agree to this for this facility, and I’m allowed to sign for it'

/** Ticks the facility agreement; the signer's name is the administrator's from the first step. */
export function agreeToAll() {
  const box = screen.getByRole('checkbox', { name: AGREEMENT_LABEL }) as HTMLInputElement
  if (!box.checked) fireEvent.click(box)
}

export const submitButton = () => button('Send')

/** Ticks the agreement and sends: the review is the check, so no dialog asks again. */
export async function submitRegistration() {
  agreeToAll()
  fireEvent.click(submitButton())
}

/** Straight from Send to the code. */
export async function toCode() {
  await toReview()
  await submitRegistration()
  await screen.findByRole('heading', { level: 1, name: 'Confirm your email' })
}

export async function verifyWith(code = '123456') {
  fireEvent.change(textbox('Code'), { target: { value: code } })
  fireEvent.click(button('Confirm'))
}

/** Through the code to the password step. */
export async function toPassword() {
  await toCode()
  await verifyWith()
  await screen.findByRole('heading', { level: 1, name: 'Choose a password' })
}

export function choosePassword(password = 'a-long-enough-password', confirm = password) {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } })
  fireEvent.click(button('Create account'))
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
