import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PatientsPage from '../app/patients/page'
import { APP_ENTRY, ROUTES } from '../content/site'
import { findHealthIDModule } from '../content/module-showcase'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/patients' }))

beforeEach(() => {
  // The page's sections measure and watch themselves as the visitor scrolls, which jsdom does not do.
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('IntersectionObserver', Observer)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }))
})

/**
 * The patient page is the Health ID Identity landing page, at /patients on this site and, for someone not signed in,
 * at the patient portal's front page (the edge serves it there). Every "Get your Health ID" on it is a step to sign-up
 * (owner, 1 Nov 2026), never this same page again.
 */
describe('the patient page', () => {
  it('sends every "Get your Health ID" to the patient sign-up', () => {
    render(<PatientsPage />)
    const links = screen.getAllByRole('link', { name: /get your health id/i, hidden: true })
    // The navigation's button, the hero's and the Identity card's in the module showcase, at least.
    expect(links.length).toBeGreaterThanOrEqual(3)
    for (const link of links) expect(link.getAttribute('href')).toBe(APP_ENTRY.patientSignUp)
    expect(APP_ENTRY.patientSignUp).toMatch(/\/enroll$/)
  })

  it('keeps the Identity card on the patient sign-up wherever the showcase shows it', () => {
    const identity = findHealthIDModule('identity')
    expect(identity?.cta).toBe('Get your Health ID')
    expect(identity?.href).toBe(APP_ENTRY.patientSignUp)
    expect(identity?.href).not.toBe(ROUTES.patients)
  })
})
