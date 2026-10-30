// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { OfflineProvider, useCachedRead, usePending, useReview, useSyncSummary } from '../react'
import { createFakeOfflineRuntime } from '../testing'
import { TransportError } from '../types'
import { ALL_DEFS, PASSWORD, PATIENT, SESSION } from './fixtures'

afterEach(cleanup)

async function fake() {
  const f = createFakeOfflineRuntime()
  f.runtime.commands.register(ALL_DEFS)
  f.runtime.prepareFromSignIn(SESSION.email, PASSWORD)
  await f.runtime.attachSession(SESSION, { optIn: true, online: true })
  return f
}

function Summary() {
  const s = useSyncSummary()
  return h('p', null, `${s.connectivity} ${s.vault} pending ${s.pending}`)
}

function Pending() {
  const items = usePending(PATIENT)
  return h('ul', null, items.map(i => h('li', { key: i.commandId }, i.label)))
}

function Review() {
  const { items } = useReview()
  return h('p', null, `review ${items.map(i => i.class).join(',')}`)
}

function Chart({ network }: { network: () => Promise<string> }) {
  const r = useCachedRead({ key: 'enc', method: 'encounters', args: [PATIENT], patientId: PATIENT, network, section: 'encounters' })
  if (r.loading) return h('p', null, 'Loading')
  if (r.error) return h('p', null, 'Could not load')
  return h('p', null, `${r.data} from ${r.source}${r.savedAt ? ` saved ${r.savedAt}` : ''}`)
}

describe('react bindings', () => {
  it('useSyncSummary and usePending follow the runtime', async () => {
    const { runtime, controls } = await fake()
    render(h(OfflineProvider, { runtime }, h(Summary), h(Pending)))
    expect(screen.getByText('online unlocked pending 0')).toBeTruthy()
    await act(async () => {
      controls.simulate('offline')
      await runtime.commands.save('ehr.encounter.create', { patientId: PATIENT })
    })
    await waitFor(() => expect(screen.getByText('offline unlocked pending 1')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('Saved on this device, not sent yet')).toBeTruthy())
  })

  it('useCachedRead shows the saved copy offline and records the offline open', async () => {
    const { runtime, controls } = await fake()
    await runtime.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false, observedAt: '' })
    await runtime.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'visit list' })
    controls.simulate('offline')
    render(h(OfflineProvider, { runtime }, h(Chart, { network: () => Promise.reject(new TransportError({ status: null, networkError: true })) })))
    await waitFor(() => expect(screen.getByText(/visit list from cache saved/)).toBeTruthy())
    expect(controls.auditEvents().map(e => e.section)).toEqual(['encounters'])
  })

  it('useReview lists items needing the author', async () => {
    const { runtime, controls } = await fake()
    controls.conflictNext()
    await runtime.commands.save('ehr.encounter.update', { patientId: PATIENT, encounter: { server: 'e1' } }, { awaitMs: 0 })
    render(h(OfflineProvider, { runtime }, h(Review)))
    await act(async () => { await controls.flush() })
    await waitFor(() => expect(screen.getByText('review CC2')).toBeTruthy())
  })
})
