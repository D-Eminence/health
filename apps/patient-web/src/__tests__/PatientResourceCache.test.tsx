import { afterEach, describe, expect, it, vi } from 'vitest'
import { useContext, useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createPatientResourceCache, PatientResourcesContext, type PatientResourceCache } from '../resourceCache'
import { createTestSessionValue, SessionContext, SessionProvider, useSession } from '../session'
import { ProfilePage } from '../routes/Portal'
import { json, patientApi, problem, profile, sectionCard, type Handler } from './portalHarness'

const environment = vi.hoisted(() => ({ name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }))
vi.mock('../env', () => ({ getEnvironment: () => environment }))
afterEach(() => { vi.unstubAllGlobals() })

/**
 * Pages open at once with what they showed last (hid-1.0's page cache, src/lib/pageCache.ts), held in memory only,
 * for the account signed in, and dropped as it signs out or another signs in.
 */
describe('the cache of the pages\' last answers', () => {
  it('answers only for the account it holds', () => {
    const cache = createPatientResourceCache('subject-a')
    cache.write('profile', 'subject-a', { name: 'Ada' })
    expect(cache.read('profile', 'subject-a')).toEqual({ value: { name: 'Ada' } })
    expect(cache.read('profile', 'subject-b')).toBeUndefined()
    expect(cache.read('records', 'subject-a')).toBeUndefined()
    // A late answer for another account, or for no one, is not kept.
    cache.write('records', 'subject-b', [])
    cache.write('records', null, [])
    expect(cache.read('records', 'subject-b')).toBeUndefined()
    expect(cache.read('records', null)).toBeUndefined()
  })

  it('keeps an answer of null, as a page reads it (a list a backend does not serve)', () => {
    const cache = createPatientResourceCache('subject-a')
    cache.write('order-routes', 'subject-a', null)
    expect(cache.read('order-routes', 'subject-a')).toEqual({ value: null })
  })

  it('drops every answer when it is held for another account, or none', () => {
    const cache = createPatientResourceCache('subject-a')
    cache.write('profile', 'subject-a', 1)
    cache.holdFor('subject-a')
    expect(cache.read('profile', 'subject-a')).toEqual({ value: 1 })
    cache.holdFor(null)
    cache.holdFor('subject-a')
    expect(cache.read('profile', 'subject-a')).toBeUndefined()
    cache.write('profile', 'subject-a', 2)
    cache.holdFor('subject-b')
    expect(cache.read('profile', 'subject-b')).toBeUndefined()
  })
})

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}

/**
 * The portal's client and its cache for subject-a, as one SessionProvider holds them; each profile read takes the
 * next answer in `answers`.
 */
function portal(answers: Array<() => Response | Promise<Response>>) {
  const handler: Handler = (path, method) => path === '/identity/me' && method === 'GET'
    ? (answers.shift() ?? (() => problem(500, 'UNEXPECTED', 'no more answers')))() : problem(500, 'UNEXPECTED', `${method} ${path}`)
  return { ...patientApi(handler), cache: createPatientResourceCache('subject-a'), answers }
}

/** The profile page, opened in `client`'s portal for `account`. */
function openProfile({ api, cache }: { api: ReturnType<typeof patientApi>['api']; cache: PatientResourceCache }, account = 'subject-a') {
  const session = createTestSessionValue({ kind: 'patient', subjectId: account, appRole: 'patient', assuranceLevel: 'aal1' }, api)
  const view = render(<MemoryRouter><SessionContext.Provider value={session}>
    <PatientResourcesContext.Provider value={{ cache, account }}><ProfilePage /></PatientResourcesContext.Provider>
  </SessionContext.Provider></MemoryRouter>)
  return view
}

/** The name About you shows (the profile's first row), or null while there is none. */
const shownName = () => document.querySelector('#bio-data dd')?.textContent ?? null
/** The profile's loading state, said to a screen reader by its name. */
const loading = () => screen.queryByRole('status', { name: 'Loading your profile' })

describe('a page opened again', () => {
  it('shows what it showed last at once, with no loading state, and the new answer once it is in', async () => {
    const later = deferred()
    const client = portal([() => json(profile), () => later.promise])
    const first = openProfile(client)
    expect(loading()).not.toBeNull()
    await waitFor(() => expect(shownName()).toBe('Ada Example'))
    first.unmount()

    openProfile(client)
    expect(shownName()).toBe('Ada Example')
    expect(loading()).toBeNull()
    // It reads again meanwhile, and says the card is being brought up to date.
    // (The emergency contacts and Delete account on the profile read for themselves.)
    await waitFor(() => expect(client.sent.map(request => request.path).filter(path => path === '/identity/me')).toEqual(['/identity/me', '/identity/me']))
    // The rows, not the whole section: Bio-data also holds the PIN's and contact's notices (PR-03).
    expect(document.querySelector('#bio-data dl')?.getAttribute('aria-busy')).toBe('true')
    expect(sectionCard('About you').getAttribute('aria-busy')).toBeNull()

    await act(async () => { later.resolve(json({ ...profile, fullName: 'Ada Updated' })) })
    expect(shownName()).toBe('Ada Updated')
    expect(screen.queryByText('Ada Example')).toBeNull()
    expect(document.querySelector('#bio-data dl')?.getAttribute('aria-busy')).toBeNull()
  })

  it('shows nothing it holds for another account', async () => {
    const client = portal([() => json(profile), () => new Promise<Response>(() => {})])
    const first = openProfile(client)
    await waitFor(() => expect(shownName()).toBe('Ada Example'))
    first.unmount()
    openProfile(client, 'subject-b')
    expect(loading()).not.toBeNull()
    expect(screen.queryByText('Ada Example')).toBeNull()
  })

  it('reads every time outside the portal session, keeping nothing', async () => {
    const { api } = patientApi(() => json(profile))
    const session = createTestSessionValue({ kind: 'patient', subjectId: 'subject-a', appRole: 'patient', assuranceLevel: 'aal1' }, api)
    const page = () => <MemoryRouter><SessionContext.Provider value={session}><ProfilePage /></SessionContext.Provider></MemoryRouter>
    const first = render(page())
    await waitFor(() => expect(shownName()).toBe('Ada Example'))
    first.unmount()
    render(page())
    expect(loading()).not.toBeNull()
    expect(shownName()).toBeNull()
  })
})

describe('the portal session', () => {
  const patient = (subject: string) => json({ actor: { kind: 'patient', subject, patientId: `patient-${subject}`, accountId: `account-${subject}` } })
  function Probe() {
    const { state, signOut } = useSession()
    const resources = useContext(PatientResourcesContext)
    const [, rendered] = useState(0)
    return <>
      <output data-testid="status">{state.status}</output>
      <output data-testid="held">{resources?.cache.read('profile', 'subject-a') ? 'held' : 'none'}</output>
      <button type="button" onClick={() => { resources?.cache.write('profile', resources.account, 'answer'); rendered(value => value + 1) }}>Keep</button>
      <button type="button" onClick={() => rendered(value => value + 1)}>Look again</button>
      <button type="button" onClick={() => void signOut()}>Sign out</button>
    </>
  }

  it('drops the answers it kept as the patient signs out, and keeps none for a later sign-in to find', async () => {
    const answers: Record<string, Array<() => Response>> = {
      'GET /api/v1/auth/session': [() => patient('subject-a'), () => patient('subject-a')],
      'POST /api/v1/auth/logout': [() => new Response(null, { status: 204 })],
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const next = answers[`${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`]?.shift()
      return next ? next() : json({ status: 418, code: 'UNEXPECTED' }, 418)
    }))
    render(<SessionProvider><Probe /></SessionProvider>)
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    await act(async () => { screen.getByRole('button', { name: 'Keep' }).click() })
    expect(screen.getByTestId('held').textContent).toBe('held')

    await act(async () => { screen.getByRole('button', { name: 'Sign out' }).click() })
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    await act(async () => { screen.getByRole('button', { name: 'Look again' }).click() })
    expect(screen.getByTestId('held').textContent).toBe('none')
  })
})
