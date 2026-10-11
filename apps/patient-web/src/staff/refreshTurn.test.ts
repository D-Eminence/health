import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); Reflect.deleteProperty(navigator, 'locks') })

/** Another window of the portal holding the refresh lock until released. */
function lockHeldElsewhere() {
  let release: () => void = () => {}
  const held = new Promise<void>(done => { release = done })
  const request = vi.fn(async (_name: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (lock: object | null) => Promise<unknown>
    const options = rest.length > 1 ? rest[0] as { ifAvailable?: boolean } : {}
    if (options.ifAvailable) return callback(null)
    await held
    return callback({})
  })
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
  return { release }
}

describe('a staff session refresh while another window refreshes', () => {
  it('waits its turn and uses the session the other window restored, sending no second refresh', async () => {
    const other = lockHeldElsewhere()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      calls.push(`${String(init.method)} ${new URL(String(url)).pathname}`)
      return new Response(JSON.stringify({ actor: { id: 'staff-1', kind: 'staff' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const { staffApi } = await import('./api')

    const refreshed = staffApi.refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    other.release()

    await expect(refreshed).resolves.toMatchObject({ actor: { id: 'staff-1' } })
    expect(calls).toEqual(['GET /api/v1/auth/session'])
  })
})

describe('a staff sign-in while another window refreshes', () => {
  it('is sent only once that refresh has finished', async () => {
    const other = lockHeldElsewhere()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      calls.push(`${String(init.method)} ${new URL(String(url)).pathname}`)
      return new Response(JSON.stringify({ actor: { id: 'staff-1', kind: 'staff' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const { staffApi } = await import('./api')

    const signedIn = staffApi.login('ada@example.test', 'correct horse battery staple', 'turnstile-token')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    other.release()

    await signedIn
    expect(calls).toEqual(['POST /api/v1/auth/login'])
  })
})

describe('a staff sign-out while another window signs in', () => {
  async function signOutAfterAnotherWindow(holder: unknown) {
    const other = lockHeldElsewhere()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      const route = `${String(init.method)} ${new URL(String(url)).pathname}`
      calls.push(route)
      if (route === 'POST /api/v1/auth/logout') return new Response(null, { status: 204 })
      return new Response(JSON.stringify(holder), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const { setStaffSessionActor } = await import('./session')
    const { staffApi } = await import('./api')
    setStaffSessionActor('staff-1')

    const signedOut = staffApi.logout()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    other.release()
    await signedOut
    return calls
  }

  it('signs out once its turn comes while the browser still holds this session', async () => {
    const calls = await signOutAfterAnotherWindow({ actor: { id: 'staff-1', kind: 'staff' } })
    expect(calls).toEqual(['GET /api/v1/auth/session', 'POST /api/v1/auth/logout'])
  })

  it.each([
    ['another staff account', { actor: { id: 'staff-2', kind: 'staff' } }],
    ['a patient', { actor: { id: 'staff-1', kind: 'patient' } }],
  ])('leaves alone the session of %s signed in meanwhile', async (_label, holder) => {
    const calls = await signOutAfterAnotherWindow(holder)
    expect(calls).toEqual(['GET /api/v1/auth/session'])
  })
})
