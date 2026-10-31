import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { DEMO_HOSPITAL, SESSION, facility, json, openStaffApp, serve, sessionAt, where } from '../../frame/blueHarness'

/*
 * In-person check inside the blue EHR's real frame, joined as departments/pages.ts will join it: it takes the frame's
 * live stand-in's place in the Clinical group, is listed where its permission is held, sends today's request, and is
 * refused in today's words where it is not. Every account, facility, person and code is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// The frame's own registry and Home, with this page joining it as departments/pages.ts does. Registered per test: a
// vi.mock factory's module outlives vi.resetModules.
beforeEach(() => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { inPersonCheckPage } = await import('../../../../ehr-blue/departments/inperson/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': { pages: [inPersonCheckPage] } }),
    }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const CHECK = 'POST /api/v1/identity/assisted-verifications'
const PERMISSION = 'identity.patient.assisted_registration'
const UNAVAILABLE = 'Your role at this facility cannot check patients in person. Doctors, clinicians and nurses at a facility that takes part in registration can. Ask a platform administrator if your role should.'
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

describe('In-person check in the frame', () => {
  it('replaces the live stand-in in place, is listed under Clinical, and reads nothing as it opens', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [PERMISSION, 'identity.registration.write'], ['clinician'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
    const { container } = await openStaffApp('/provider/in-person-check')
    expect(await screen.findByRole('heading', { level: 1, name: 'In-person check' })).toBeDefined()
    expect(where()).toBe('/provider/in-person-check')
    // The blue page, not today's page inside the frame.
    expect(container.querySelector('.hid-ehr-dept-inperson')).not.toBeNull()
    expect(container.querySelector('.staff-in-person')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Desk code' })).toBeDefined()
    // Its sidebar entry is the stand-in's, in the stand-in's place: after Patient registration, before Appointments.
    const link = within(nav()).getByRole('link', { name: 'In-person check' })
    expect(link.getAttribute('href')).toBe('/provider/in-person-check')
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(link.querySelector('svg.hid-ehr-dept-icon')).not.toBeNull()
    const names = within(nav()).getAllByRole('link').map(item => item.textContent?.trim())
    expect(names.indexOf('In-person check')).toBe(names.indexOf('Patient registration') + 1)
    expect(names.indexOf('Appointments')).toBe(names.indexOf('In-person check') + 1)
    expect(names.filter(name => name === 'In-person check')).toHaveLength(1)
    await settle()
    expect(sent.map(call => call.route)).toEqual([SESSION])
  })

  it('sends today’s request through today’s API and shows the outcome', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [PERMISSION], ['clinician'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [CHECK]: [() => json({ outcome: 'verified' })] })
    await openStaffApp('/provider/in-person-check')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Desk code' }), { target: { value: 'abcd-efgh jk' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Document checked' }), { target: { value: 'voters_card' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), { target: { value: 'Demo-Patient' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Last name' }), { target: { value: 'Fictional-One' } })
    for (const box of within(screen.getByRole('group', { name: 'Confirm each statement' })).getAllByRole('checkbox')) fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Check the details' }))
    expect(await screen.findByRole('heading', { name: 'Checked. The patient can continue on their phone.' })).toBeDefined()
    const checks = sent.filter(call => call.route === CHECK)
    expect(checks).toHaveLength(1)
    expect(checks[0]!.body).toEqual({
      deskCode: 'ABCDEFGHJK', method: 'government_photo_id_in_person', documentType: 'voters_card',
      document: { firstName: 'Demo-Patient', lastName: 'Fictional-One' },
      attestations: { patientPresent: true, originalDocumentSeen: true, photoMatchesPerson: true, codeShownOnPatientsOwnDevice: true, patientConsents: true },
    })
    const init = (vi.mocked(fetch).mock.calls.find(call => String(call[0]).endsWith('/api/v1/identity/assisted-verifications'))?.[1] ?? {}) as RequestInit
    expect(new Headers(init.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(where()).toBe('/provider/in-person-check')
    expect(document.body.textContent).not.toMatch(/Demo-Patient|Fictional-One|ABCDEFGHJK/)
  })

  it('is refused without its permission in today’s words, unlisted, and reads nothing', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'], ['clinician'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/in-person-check')
    expect(await screen.findByText(UNAVAILABLE)).toBeDefined()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('In-person check unavailable')
    expect(screen.queryByText(/is not open to you here/)).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Desk code' })).toBeNull()
    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Patients' })).toBeDefined())
    expect(within(nav()).queryByRole('link', { name: 'In-person check' })).toBeNull()
    await settle()
    expect(sent.map(call => call.route)).toEqual([SESSION])
  })
})
