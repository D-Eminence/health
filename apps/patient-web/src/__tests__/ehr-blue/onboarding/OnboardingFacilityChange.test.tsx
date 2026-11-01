import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BLUE_FACILITIES } from '../../../ehr-blue/blueFacilities'
import { BluePageProvider } from '../../../ehr-blue/frame/pageContext'
import { FacilitySetup } from '../../../ehr-blue/onboarding/FacilitySetup'
import { onboardingPage } from '../../../ehr-blue/onboarding/page'

/*
 * Facility setup when the working facility changes while the page stays open: the frame keys a page by its address
 * alone, and a demo facility has nine steps where a real one has five. The open step is the one it was, by name, among
 * the steps the facility has; one it does not have opens the first step. Fictional facilities only; nothing is sent.
 */
const staff = vi.hoisted(() => ({ facility: undefined as unknown }))
vi.mock('../../../staff/App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: staff.facility } } } }),
}))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

interface Named { readonly id: string; readonly name: string }
const DEMO: Named = { id: BLUE_FACILITIES[0].id, name: 'Demo Hospital' }
const REAL: Named = { id: 'f0000000-0000-4000-8000-000000000001', name: 'Riverside Teaching Hospital (fictional)' }

/** A facility membership as the session reports it, for its administrator: signed up by itself and checked. */
const facility = ({ id, name }: Named) => ({
  id, membershipId: `member-${id}`, organizationId: 'org-demo', name, roles: ['org_admin'], permissions: ['workforce.manage'],
  isPrimary: true, selfService: { review: 'reviewed', organizationType: 'hospital' },
})

const fetchStub = vi.fn(() => Promise.reject(new Error('Tests never reach the network.')))
beforeEach(() => { fetchStub.mockClear(); vi.stubGlobal('fetch', fetchStub) })
afterEach(() => { vi.unstubAllGlobals() })

function Wizard({ rest }: { readonly rest: string }) {
  return (
    <MemoryRouter initialEntries={[`/provider/onboarding/${rest}`]}>
      <BluePageProvider value={{ page: onboardingPage, rest }}><FacilitySetup /></BluePageProvider>
    </MemoryRouter>
  )
}

/** Opens the wizard at `rest` for `from`, then changes the working facility to `to`, the address unchanged. */
function openThenChange(rest: string, from: Named, to: Named) {
  staff.facility = facility(from)
  const view = render(<Wizard rest={rest} />)
  const before = eyebrow()
  staff.facility = facility(to)
  view.rerender(<Wizard rest={rest} />)
  return before
}

const eyebrow = () => document.querySelector('.hid-ehr-onboarding .hid-ehr-page-eyebrow')?.textContent ?? ''
const stepper = () => screen.getByRole('navigation', { name: 'Onboarding steps' })
const current = () => within(stepper()).getAllByRole('button').filter(button => button.getAttribute('aria-current') === 'step')
  .map(button => button.textContent)

describe('the working facility changes while Facility setup is open', () => {
  it('opens the first step when a demo facility\'s sample step is open and the facility becomes a real one', () => {
    expect(openThenChange('billing', DEMO, REAL)).toBe('Step 7 of 9 · Billing')
    expect(eyebrow()).toBe('Step 1 of 5 · Facility')
    expect(current()).toEqual(['1. Facility'])
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    // Nothing of the Billing sample stays on screen.
    expect(screen.queryByText('Payment policy')).toBeNull()
    expect(screen.queryByText('Sample only: not connected to Health ID yet. Nothing you do here is saved.')).toBeNull()
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('keeps a step both facilities have, counted among the new facility\'s steps', () => {
    expect(openThenChange('review', DEMO, REAL)).toBe('Step 8 of 9 · Review')
    expect(eyebrow()).toBe('Step 4 of 5 · Review')
    expect(current()).toEqual(['4. Review'])
    expect(screen.getByRole('heading', { level: 2, name: 'Review your configuration' })).toBeDefined()
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('does the same the other way, from a real facility to a demo one', () => {
    expect(openThenChange('review', REAL, DEMO)).toBe('Step 4 of 5 · Review')
    expect(eyebrow()).toBe('Step 8 of 9 · Review')
    expect(current()).toEqual(['8. Review'])
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
