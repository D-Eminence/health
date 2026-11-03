import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthLayout } from '../AuthLayout'
import { PatientSignup } from '../routes/enrollment/Signup'
import { createTestSessionValue, SessionContext } from '../session'
import { patientApi, problem } from './portalHarness'

/**
 * What every sign-in, sign-up and recovery page promises (launch audit SO-02 and SO-11, owner decisions of
 * 2026-11-03). Emergency access is on at launch, so records are not shared "only with the facilities you approve";
 * and at launch Records shows visits and doctors' notes from Health ID hospitals, what the patient adds, and who
 * opened the record, not lab results or prescriptions from every hospital.
 */
vi.mock('../Turnstile', () => ({ Turnstile: () => null }))

const TRUST = 'You choose who can see your records. In an emergency, a hospital can open them, and we tell you.'
const CARD_LINES = ['Visits and doctors’ notes from Health ID hospitals', 'The health information you add', 'Who has opened your record']

function layout() {
  return render(<MemoryRouter><AuthLayout brandTo="/" title="Welcome back." titleId="t"><p>Form</p></AuthLayout></MemoryRouter>)
}

describe('the line under every auth form (SO-02)', () => {
  it('says the patient chooses who sees their records, and that a hospital can open them in an emergency', () => {
    const { container } = layout()
    expect(container.querySelector('.auth-trust')?.textContent).toBe(TRUST)
    expect(container.textContent).not.toMatch(/only with the facilities you approve/)
  })
})

describe('what the wide-screen card says an account includes (SO-11)', () => {
  it('lists only what the portal shows today', () => {
    const { container } = layout()
    expect([...container.querySelectorAll('.auth-print-card li')].map(item => item.textContent?.replace('✓', ''))).toEqual(CARD_LINES)
  })

  it('promises no lab results, prescriptions or every hospital anywhere in the panel', () => {
    const { container } = layout()
    const aside = container.querySelector('.auth-aside')?.textContent ?? ''
    expect(aside).not.toMatch(/lab results|prescriptions|every hospital|you approve who sees/i)
    expect(container.querySelector('.auth-aside-overline')?.textContent).not.toMatch(/every hospital/i)
  })

  it('does not promise records from every hospital in the sign-up\'s introduction', () => {
    const { api } = patientApi(path => problem(500, 'UNEXPECTED', path))
    render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue(null, api)}>
      <PatientSignup signedInByActivation={async () => false} onProceed={() => undefined} />
    </SessionContext.Provider></MemoryRouter>)
    const lede = document.querySelector('.auth-lede')?.textContent ?? ''
    expect(lede).not.toMatch(/every hospital/i)
    expect(lede).toMatch(/Health ID hospitals/)
    expect(screen.getByRole('heading', { level: 1, name: 'Create your Health ID.' })).toBeTruthy()
  })
})
