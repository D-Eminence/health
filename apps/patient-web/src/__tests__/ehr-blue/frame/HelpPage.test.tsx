import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProductHostname from '../../../productHostname'
import { HelpPage } from '../../../ehr-blue/frame/HelpPage'

/**
 * Help opens on every staff site (lab., pharmacy., outreach. and migrate. too), so it teaches only what opens on the
 * site it is open on: a guide or a line of what's new about the hospital's pages (Patient registration, Consultation,
 * Emergency access, Home's Today's work) shows on the EHR only. Every account and facility is fictional, and each host
 * is only what the page is told it runs on: nothing is sent there.
 */
const host = vi.hoisted(() => ({ name: 'ehr.healthidentitydirectory.com' }))
/** A role that holds every guide's permission, so only the site decides which guides show. */
const EVERY_GUIDE = ['identity.registration.write', 'identity.patient.read', 'ehr.vital.write', 'ehr.encounter.write', 'ehr.lab-request.write',
  'ehr.prescription.write', 'lab.work-item.read', 'pharmacy.work-item.read', 'identity.break-glass.write']

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', supportChatEnabled: false, supportContact: null }) }))
vi.mock('../../../productHostname', async importOriginal => {
  const actual = await importOriginal<typeof ProductHostname>()
  return { ...actual, resolveStaffProductHostname: () => actual.resolveStaffProductHostname(host.name) }
})
vi.mock('../../../staff/App', () => ({
  useStaff: () => {
    const facility = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Riverside Facility (fictional)',
      roles: ['facility_admin'], permissions: EVERY_GUIDE, isPrimary: true }
    return { state: { status: 'ready', session: { actor: { id: 'staff-1', email: 'admin@example.test', displayName: 'Demo Admin', roles: [],
      permissions: [], facilities: [facility], facility }, expiresAt: '2026-11-30T12:00:00.000Z' } } }
  },
}))

beforeEach(() => { host.name = 'ehr.healthidentitydirectory.com' })

/** The guides listed, by title. */
const guides = () => Array.from(document.querySelectorAll('summary'), summary => summary.textContent)
/** The lines of what's new. */
const whatsNew = () => {
  expect(screen.getByRole('heading', { level: 2, name: 'What’s new' })).toBeTruthy()
  return Array.from(document.querySelectorAll('ul.list-disc > li'), line => line.textContent ?? '')
}

const EHR_ONLY_LINES = [
  /^Typing a diagnosis suggests matches/, /^Common complaints are one tap/, /^Back takes you to where you came from/, /^Today’s work on Home/,
  /^Ask about this patient is in the patient banner/, /^The latest vitals show/, /^After saving vitals/, /^Emergency access sits beside Access requests/,
  /^Find a patient \(from a button\), a new registration/,
]
const EMERGENCY_NOTE = 'Use Emergency access only when the patient can’t consent and care can’t wait.'

describe('Help, on the site it is open on', () => {
  it('on the EHR, lists every guide the role may take, with the Emergency note, and every line of what’s new', () => {
    render(<HelpPage />)
    expect(guides()).toEqual(['Register a new patient', 'Find a patient and get access', 'Record vitals', 'Run a consultation', 'Order a lab test',
      'Prescribe a medicine', 'Process lab work', 'Dispense a prescription', 'Use emergency access'])
    expect(screen.getByText(EMERGENCY_NOTE)).toBeTruthy()
    const lines = whatsNew()
    for (const line of EHR_ONLY_LINES) expect(lines.some(text => line.test(text)), String(line)).toBe(true)
    expect(lines).toHaveLength(12)
  })

  it('on lab., lists only the lab’s guide, none of the hospital’s (no Find a patient, no Register a new patient), and no EHR-only line', () => {
    host.name = 'lab.healthidentitydirectory.com'
    render(<HelpPage />)
    expect(guides()).toEqual(['Process lab work'])
    expect(screen.queryByText('Find a patient and get access')).toBeNull()
    expect(screen.queryByText('Register a new patient')).toBeNull()
    expect(screen.queryByText(EMERGENCY_NOTE)).toBeNull()
    const lines = whatsNew()
    for (const line of EHR_ONLY_LINES) expect(lines.some(text => line.test(text)), String(line)).toBe(false)
    // What opens here too: the Guide, and Find a patient (Patients is on every site).
    expect(lines.some(text => text.startsWith('Guide, in the top bar of every page'))).toBe(true)
    expect(lines.some(text => text.startsWith('Find a patient checks a pasted or scanned Health ID'))).toBe(true)
  })

  it('on pharmacy., lists only the pharmacy’s guide', () => {
    host.name = 'pharmacy.healthidentitydirectory.com'
    render(<HelpPage />)
    expect(guides()).toEqual(['Dispense a prescription'])
  })

  it.each(['outreach', 'migrate'])('on %s., lists none of the hospital’s guides or lines', product => {
    host.name = `${product}.healthidentitydirectory.com`
    render(<HelpPage />)
    expect(guides()).toEqual([])
    expect(screen.getByText('There are no guides for your role yet.')).toBeTruthy()
    const lines = whatsNew()
    for (const line of EHR_ONLY_LINES) expect(lines.some(text => line.test(text)), String(line)).toBe(false)
  })
})
