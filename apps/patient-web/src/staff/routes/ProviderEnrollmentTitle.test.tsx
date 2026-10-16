import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderEnrollment } from './ProviderEnrollment'

/** PEHR-05: provider enrollment names the browser tab, which index.html names for patients. */
vi.mock('../../Turnstile', () => ({ Turnstile: () => null }))
vi.mock('../api', () => ({ providerEnrollmentApi: {} }))
// The page asks whether clinician self sign-up is open (hid-system ADR-066); that has tests of its own.
vi.mock('../clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
beforeEach(() => { document.title = 'Health ID: Patient' })

describe('PEHR-05: provider enrollment', () => {
  it('names the tab while it is open, and gives the title back when it closes', () => {
    const { unmount } = render(<MemoryRouter><ProviderEnrollment /></MemoryRouter>)
    expect(document.title).toBe('Provider enrollment · Health ID Provider')
    unmount()
    expect(document.title).toBe('Health ID: Patient')
  })
})
