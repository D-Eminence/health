import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BluePageBoundary } from '../../../ehr-blue/frame/BluePageBoundary'
import {
  DEMO_HOSPITAL, DEMO_LABORATORY, FACILITY, REAL_FACILITY, REQUESTS, SESSION, facility, homeHeading, json, openStaffApp, problem, serve,
  sessionAt, where, withFramePages,
} from './blueHarness'

/**
 * Parity report rows of the "frame, facility chooser and sign-in" group (docs/BLUE_EHR_PARITY_2026-11-01.md 16a, 3.3-47,
 * 3.3-50's frame part, 3.3-51, 3.3-52; 3.3-46 is in auth/BlueAuth.test.tsx): the blue frame says and does what the
 * classic portal did. Every account, facility and patient here is fictional, and every request goes to the stubbed fetch.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const menu = () => within(screen.getByRole('navigation', { name: 'Main navigation' }))

/** Opens the staff app for one fictional facility holding `permissions`. */
async function openAt(permissions: readonly string[], path = '/provider', routes: Record<string, (() => Response)[]> = {}) {
  const clinic = facility(REAL_FACILITY, 'Riverside Clinic (fictional)', permissions, ['clinician'])
  const sent = serve({ [SESSION]: [sessionAt(clinic, [clinic])], [REQUESTS]: many(() => json([])), ...routes })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

/** A response the test answers when it chooses. */
function deferred() {
  let respond: (response: Response) => void = () => undefined
  const promise = new Promise<Response>(resolve => { respond = resolve })
  return { answer: () => promise, respond: (response: Response) => respond(response) }
}

describe('16a: the sidebar footer says classic\'s sentence, without "permissions"', () => {
  beforeEach(() => { withFramePages() })

  it('says "Access is limited to your active facility." under the role, and never the word "permission"', async () => {
    await openAt(['identity.patient.read'])
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    const note = screen.getByText('Access is limited to your active facility.')
    expect(note.textContent).toBe('Access is limited to your active facility.')
    expect(screen.queryByText(/server permissions/)).toBeNull()
  })
})

describe('3.3-47: "Where are you working?" behaves as classic\'s FacilityChoice', () => {
  beforeEach(() => { withFramePages() })
  const hospital = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
  const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
  const option = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) }) as HTMLInputElement

  async function ask(routes: Record<string, (() => Response | Promise<Response>)[]> = {}) {
    const sent = serve({ [SESSION]: [sessionAt(undefined, [hospital, lab], 'default')], [REQUESTS]: many(() => json([])), ...routes })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Where are you working?' })
    return sent
  }

  it('says "Choose a facility to continue." at the options, not as an alert, when Continue moves focus into them', async () => {
    const sent = await ask()
    const proceed = screen.getByRole('button', { name: 'Continue' })
    proceed.focus()
    fireEvent.click(proceed)
    const missing = screen.getByText('Choose a facility to continue.')
    expect(missing.getAttribute('role')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(option('Demo Hospital'))
    expect(screen.getByRole('group', { name: 'Facility' }).getAttribute('aria-describedby')).toContain(missing.id)
    expect(sent.some(call => call.route === FACILITY)).toBe(false)
  })

  it('says it as an alert, new each time, when sent with Enter on an option, as focus does not move', async () => {
    await ask()
    option('Demo Hospital').focus()
    fireEvent.submit(option('Demo Hospital').form!)
    const missing = screen.getByRole('alert')
    expect(missing.textContent).toBe('Choose a facility to continue.')
    expect(document.activeElement).toBe(option('Demo Hospital'))
    fireEvent.submit(option('Demo Hospital').form!)
    expect(screen.getByRole('alert')).not.toBe(missing)
  })

  it('moves focus to Continue when a choice is sent with Enter on an option', async () => {
    const saving = deferred()
    const sent = await ask({ [FACILITY]: [saving.answer] })
    fireEvent.click(option('Demo Laboratory'))
    option('Demo Laboratory').focus()
    fireEvent.submit(option('Demo Laboratory').form!)
    const proceed = await screen.findByRole('button', { name: 'Saving…' })
    expect(document.activeElement).toBe(proceed)
    expect(option('Demo Laboratory').matches(':disabled')).toBe(true)
    await act(async () => { saving.respond(await sessionAt(lab, [hospital, lab], 'selected')()) })
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: DEMO_LABORATORY }])
  })

  it('says a refusal as classic does: a plain line with role="alert" at the options, which it describes, not a boxed alert', async () => {
    await ask({ [FACILITY]: [() => problem(403, 'FACILITY_ACCESS_DENIED', 'The actor is not active at the facility.')] })
    fireEvent.click(option('Demo Laboratory'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const refusal = await screen.findByText('You are no longer active at Demo Laboratory. Choose another facility.')
    expect(refusal.tagName).toBe('P')
    expect(refusal.getAttribute('role')).toBe('alert')
    expect(screen.queryByText('That facility couldn’t be opened')).toBeNull()
    expect(screen.getByRole('group', { name: 'Facility' }).getAttribute('aria-describedby')).toContain(refusal.id)
    // Picking another clears it, as classic's did.
    fireEvent.click(option('Demo Hospital'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the design\'s eyebrow and each facility\'s role line (frame/tour/journeys.ts:52, :76)', async () => {
    await ask()
    expect(screen.getByText('Health ID · Hospital EHR')).toBeDefined()
    expect(option('Demo Hospital').closest('label')!.textContent).toContain('Clinician')
  })

  it('on the Switch facility page, Enter on another facility sends nothing and leads to the question\'s Switch facility', async () => {
    const sent = serve({ [SESSION]: [sessionAt(hospital, [hospital, lab])], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider/institutions')
    await screen.findByRole('heading', { level: 1, name: 'Switch facility' })
    fireEvent.click(option('Demo Laboratory'))
    option('Demo Laboratory').focus()
    fireEvent.submit(option('Demo Laboratory').form!)
    const question = screen.getByRole('group', { name: 'You are working at Demo Hospital. Switch to Demo Laboratory?' })
    expect(document.activeElement).toBe(within(question).getByRole('button', { name: 'Switch facility' }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(sent.some(call => call.route === FACILITY)).toBe(false)
  })

  it('says a refused switch on the Switch facility page in the same plain line', async () => {
    serve({ [SESSION]: [sessionAt(hospital, [hospital, lab])], [REQUESTS]: many(() => json([])),
      [FACILITY]: [() => problem(403, 'FACILITY_ACCESS_DENIED', 'The actor is not active at the facility.')] })
    await openStaffApp('/provider/institutions')
    await screen.findByRole('heading', { level: 1, name: 'Switch facility' })
    fireEvent.click(option('Demo Laboratory'))
    fireEvent.click(within(screen.getByRole('group', { name: /Switch to Demo Laboratory\?/ })).getByRole('button', { name: 'Switch facility' }))
    const refusal = await screen.findByText('You are no longer active at Demo Laboratory. Choose another facility.')
    expect(refusal.tagName).toBe('P')
    expect(refusal.getAttribute('role')).toBe('alert')
    expect(screen.queryByText('That facility couldn’t be opened')).toBeNull()
  })
})

describe('3.3-50: the clinical pages classic opened for every role open in the frame, without "<page> unavailable"', () => {
  // The blue EHR's own registry: these are the clinical folder's pages, not stand-ins (withFramePages' mock outlives
  // vi.resetModules, so it is taken off).
  beforeEach(() => { vi.doUnmock('../../../ehr-blue/routes') })
  it.each([
    ['patients', 'Patients'],
    ['clinical', 'Consultation'],
    ['triage', 'Triage & Vitals'],
    ['nursing', 'Nursing observations'],
    ['emergency', 'Emergency access'],
  ])('/provider/%s opens the %s page itself for a role without its permission, still unlisted', async (path, label) => {
    await openAt(['audit.read'], `/provider/${path}`)
    await waitFor(() => expect(document.querySelector('.hid-ehr-blue-page h1')).not.toBeNull())
    expect(screen.queryByRole('heading', { level: 1, name: `${label} unavailable` })).toBeNull()
    expect(screen.queryByText('Your role at this facility doesn’t include this page. Ask your facility administrator.')).toBeNull()
    expect(where()).toBe(`/provider/${path}`)
    expect(menu().queryByRole('link', { name: label })).toBeNull()
    expect(document.querySelector('.hid-ehr-blue-page h1')!.textContent).not.toMatch(/unavailable$/)
  })

  it('still refuses in its place any other page the role may not open', async () => {
    await openAt(['audit.read'], '/provider/laboratory')
    expect(await screen.findByRole('heading', { level: 1, name: /^Laboratory/ })).toBeDefined()
    expect(document.querySelector('.hid-ehr-blue-page')!.textContent).toMatch(/doesn’t include/)
  })
})

describe('3.3-51: the tab title is the page\'s again once a drawer closes', () => {
  it('names the tab after the page under a drawer when the drawer closes, after the page in it renamed the tab', async () => {
    function NamesTheTab() {
      useEffect(() => { document.title = 'Find a patient (fictional drawer) · Health ID EHR' }, [])
      return <h1>Find a patient (fictional)</h1>
    }
    withFramePages(() => [
      { path: 'audit/*', group: 'Insight', label: 'Audit trail', status: 'live', element: <Link to="/provider/patients">Find a patient (fictional link)</Link> },
      { path: 'patients/*', group: 'Clinical', label: 'Patients', status: 'live', element: <NamesTheTab /> },
    ])
    await openAt(['audit.read'], '/provider/audit')
    await waitFor(() => expect(document.title).toBe('Audit trail · Health ID EHR'))
    fireEvent.click(screen.getByRole('link', { name: 'Find a patient (fictional link)' }))
    const drawer = await screen.findByRole('dialog')
    await waitFor(() => expect(document.title).toBe('Find a patient (fictional drawer) · Health ID EHR'))
    fireEvent.click(within(drawer).getAllByRole('button', { name: /close/i })[0]!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(where()).toBe('/provider/audit')
    await waitFor(() => expect(document.title).toBe('Audit trail · Health ID EHR'))
  })
})

describe('3.3-52: a page that fails offers classic\'s way to the overview', () => {
  it('links "Go to your overview" to the site\'s root, as AppErrorBoundary does', () => {
    function Broken(): never { throw new Error('fictional failure') }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<BluePageBoundary><Broken /></BluePageBoundary>)
    const alert = screen.getByRole('alert')
    expect(within(alert).getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeDefined()
    expect(within(alert).getByRole('link', { name: 'Go to your overview' }).getAttribute('href')).toBe('/')
    expect(document.body.textContent).not.toContain('fictional failure')
  })
})
