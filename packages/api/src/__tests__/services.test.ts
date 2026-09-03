import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@hid/http'
import { BoundaryViolationError } from '@hid/contracts'
import { createHidApi } from '../index'
import { createServiceBinding } from '../service'
import type { HidApp } from '@hid/contracts'

function harness<A extends HidApp>(app: A) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  const client = createApiClient({
    baseUrl: 'https://gateway.staging.example',
    clientId: app,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getAccessToken: () => 'token',
    sleep: async () => {},
  })

  return { api: createHidApi({ app, client }), calls, client }
}

describe('service modules — routing', () => {
  it('sends a service call to the endpoint named in the registry', async () => {
    const { api, calls } = harness('patient-web')
    await api.identity.getMyPatientProfile()

    expect(calls[0]?.url).toBe('https://gateway.staging.example/patients-me')
    expect(calls[0]?.init.method).toBe('GET')
  })

  it('applies the registry auth requirement without the caller restating it', async () => {
    const { api, calls } = harness('patient-web')
    await api.identity.patientLogin({ identifier: 'x' })

    // patient-login is public: no token is attached even though one exists.
    expect(new Headers(calls[0]?.init.headers).has('Authorization')).toBe(false)

    await api.identity.getMyPatientProfile()
    expect(new Headers(calls[1]?.init.headers).get('Authorization')).toBe('Bearer token')
  })

  it('passes query parameters through to the transport', async () => {
    const { api, calls } = harness('patient-web')
    await api.ehr.listRecords({ limit: 10 })

    expect(calls[0]?.url).toBe('https://gateway.staging.example/patients-records?limit=10')
  })

  it('forwards an abort signal so screens can cancel in-flight reads', async () => {
    const { api, calls } = harness('patient-web')
    const controller = new AbortController()
    await api.ehr.listRecords({}, { signal: controller.signal })

    expect(calls[0]?.init.signal).toBeDefined()
  })
})

describe('service modules — boundaries', () => {
  it('does not give the patient application an admin service at all', () => {
    const { api } = harness('patient-web')

    // @ts-expect-error patient-web is not granted the admin service.
    expect(api.admin).toBeUndefined()
  })

  it('does not give the public site anything clinical', () => {
    const { api } = harness('public-web')

    // @ts-expect-error public-web is granted only the platform service.
    expect(api.ehr).toBeUndefined()
    // @ts-expect-error public-web is granted only the platform service.
    expect(api.identity).toBeUndefined()
  })

  it('allows the public site the one service it owns', async () => {
    const { api, calls } = harness('public-web')
    await api.platform.healthCheck()

    expect(calls).toHaveLength(1)
  })

  it('lets the admin application use admin endpoints', async () => {
    const { api, calls } = harness('admin-web')
    await api.admin.getBilling({ month: '2026-09' })

    expect(calls[0]?.url).toContain('/admin-billing')
  })

  it('keeps outreach away from the record services', async () => {
    const { api } = harness('outreach-web')

    // @ts-expect-error outreach-web is granted identity and outreach only.
    expect(api.ehr).toBeUndefined()
    await expect(api.outreach.signup({})).resolves.toBeDefined()
  })

  it('gives lab and pharmacy no client for services with no backend contracts', () => {
    const lab = harness('lab-web').api
    const pharmacy = harness('pharmacy-web').api

    expect('lab' in lab).toBe(false)
    expect('pharmacy' in pharmacy).toBe(false)
    // Identity is granted and does exist, so the applications are not empty shells.
    expect(lab.identity).toBeDefined()
    expect(pharmacy.identity).toBeDefined()
  })

  it('still refuses a cross-boundary call made through a raw binding', () => {
    const { client, calls } = harness('patient-web')
    const call = createServiceBinding({ app: 'patient-web', client }, 'admin')

    expect(() => call('admin-dashboard-overview', 'GET')).toThrow(BoundaryViolationError)
    expect(calls).toHaveLength(0)
  })
})

describe('service binding — misuse', () => {
  it('rejects an endpoint that belongs to a different service', () => {
    const { client } = harness('patient-web')
    const call = createServiceBinding({ app: 'patient-web', client }, 'ehr')

    expect(() => call('patients-me', 'GET')).toThrow(/belongs to the "identity" service/)
  })

  it('rejects a method the backend does not declare', () => {
    const { client } = harness('patient-web')
    const call = createServiceBinding({ app: 'patient-web', client }, 'ehr')

    expect(() => call('patients-records', 'POST')).toThrow(/does not accept POST/)
  })

  it('rejects an endpoint that is not in the registry at all', () => {
    const { client } = harness('patient-web')
    const call = createServiceBinding({ app: 'patient-web', client }, 'ehr')

    expect(() => call('records-archive', 'POST')).toThrow(/not a known Health ID endpoint/)
  })
})
