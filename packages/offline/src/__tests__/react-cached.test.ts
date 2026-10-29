// @vitest-environment jsdom
// Finding 8 of the coordinator review: useCachedRead must follow the saved copy (grant expiry) and the late network answer.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { OfflineProvider, useCachedRead } from '../react'
import { TransportError } from '../types'
import { PATIENT } from './fixtures'
import { createServer, makeEnv, makeRuntime, signIn } from './harness'

afterEach(cleanup)

const T0 = Date.parse('2026-10-29T09:00:00.000Z')

function Chart({ network }: { network: () => Promise<string> }) {
  const r = useCachedRead({ key: 'enc', method: 'encounters', args: [PATIENT], patientId: PATIENT, network, section: 'encounters' })
  if (r.loading) return h('p', null, 'Loading')
  if (r.data === undefined) return h('p', null, 'Not available offline')
  return h('p', null, `${r.data} from ${r.source}`)
}

async function ready() {
  const env = makeEnv()
  const rt = makeRuntime({ server: createServer(), env })
  await signIn(rt)
  await rt.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: new Date(T0 + 3600_000).toISOString(), breakGlass: false, observedAt: '' })
  await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'saved list' })
  return { rt, env }
}

describe('useCachedRead with the real runtime', () => {
  it('stops showing the saved copy once the grant has expired', async () => {
    const { rt, env } = await ready()
    render(h(OfflineProvider, { runtime: rt }, h(Chart, { network: () => Promise.reject(new TransportError({ status: null, networkError: true })) })))
    await waitFor(() => expect(screen.getByText('saved list from cache')).toBeTruthy())
    await act(async () => {
      env.wall += 2 * 3600_000
      await rt.tick()
    })
    await waitFor(() => expect(screen.getByText('Not available offline')).toBeTruthy())
  })

  it('a slow network answer replaces the saved copy on screen', async () => {
    const { rt } = await ready()
    let release: (v: string) => void = () => undefined
    const slow = new Promise<string>(r => { release = r })
    render(h(OfflineProvider, { runtime: rt }, h(Chart, { network: () => slow })))
    await waitFor(() => expect(screen.getByText('saved list from cache')).toBeTruthy())
    await act(async () => { release('fresh list') })
    await waitFor(() => expect(screen.getByText('fresh list from network')).toBeTruthy())
  })
})
