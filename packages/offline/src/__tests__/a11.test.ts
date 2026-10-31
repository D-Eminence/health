// Contract A11 (screens questions): refusal details through the transport, and a database check that creates nothing.
import 'fake-indexeddb/auto'
import { HidApiError, type ApiClient, type RequestSpec } from '@hid/http'
import { describe, expect, it } from 'vitest'
import { offlineDatabaseExists, transportFromApiClient } from '..'
import { TransportError } from '../types'
import { createServer, makeEnv, makeRuntime, signIn } from './harness'

describe('A11.2: transportFromApiClient keeps the refusal details', () => {
  it('a 400 VALIDATION_FAILED carries its details (field errors) in the TransportError body', async () => {
    const details = { errors: [{ field: 'reason', code: 'required' }] }
    const client = {
      baseUrl: 'https://example.invalid',
      request: async (_spec: RequestSpec) => {
        throw new HidApiError(400, 'Check the highlighted fields.', { code: 'VALIDATION_FAILED', details, fields: { reason: 'no_match' } })
      },
      get: async () => undefined,
      post: async () => undefined,
    } as unknown as ApiClient
    const error = await transportFromApiClient(client)({ method: 'POST', path: '/api/v1/x', body: {} }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TransportError)
    expect((error as TransportError).body).toMatchObject({ code: 'VALIDATION_FAILED', details, fields: { reason: 'no_match' } })
  })
})

describe('A11.1: offlineDatabaseExists never creates the database', () => {
  it('false with no database, creates nothing; true once a vault exists', async () => {
    expect(await indexedDB.databases()).toEqual([])
    expect(await offlineDatabaseExists()).toBe(false)
    expect(await indexedDB.databases()).toEqual([])
    const server = createServer()
    const rt = makeRuntime({ server, env: makeEnv(), idb: indexedDB })
    await signIn(rt, { server })
    expect(await offlineDatabaseExists()).toBe(true)
  })
})

describe('A11.1 without indexedDB.databases()', () => {
  it('a probe that aborts the upgrade answers false and creates nothing; true for an existing database', async () => {
    const { IDBFactory } = await import('fake-indexeddb')
    const { databaseExists, OfflineStore } = await import('../store')
    const real = new IDBFactory()
    // The same factory with databases() hidden, as in browsers without it.
    const noList = new Proxy(real, { get: (t, p) => (p === 'databases' ? undefined : Reflect.get(t, p, t)) }) as IDBFactory
    expect(await databaseExists(noList)).toBe(false)
    expect(await real.databases()).toEqual([])
    const store = await OfflineStore.open(real)
    store.close()
    expect(await databaseExists(noList)).toBe(true)
  })
})

describe('A11.1 when indexedDB.databases() throws', () => {
  it('falls back to the probe: false and nothing created; true for an existing database', async () => {
    const { IDBFactory } = await import('fake-indexeddb')
    const { databaseExists, OfflineStore } = await import('../store')
    const real = new IDBFactory()
    const throwing = new Proxy(real, {
      get: (t, p) => (p === 'databases' ? () => Promise.reject(new Error('not allowed')) : Reflect.get(t, p, t)),
    }) as IDBFactory
    expect(await databaseExists(throwing)).toBe(false)
    expect(await real.databases()).toEqual([])
    const store = await OfflineStore.open(real)
    store.close()
    expect(await databaseExists(throwing)).toBe(true)
  })
})
