import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import type { UpdateSafeAnswer, UpdateSafeQuery } from '../contracts'
import { PATIENT } from './fixtures'
import { createServer, makeEnv, makeRuntime, privateChannel, settle, signIn, until } from './harness'

function ask(channelName: string, waitMs = 500): Promise<UpdateSafeAnswer[]> {
  const ch = new BroadcastChannel(channelName)
  const id = crypto.randomUUID()
  const answers: UpdateSafeAnswer[] = []
  ch.onmessage = e => { const m = e.data as UpdateSafeAnswer; if (m.type === 'update-safe' && m.id === id) answers.push(m) }
  ch.postMessage({ type: 'update-safe-query', id } satisfies UpdateSafeQuery)
  return new Promise(resolve => setTimeout(() => { ch.close(); resolve(answers) }, waitMs))
}

describe('update-safe query (A7)', () => {
  it('a tab answers safe:false while a command is sending, safe:true once nothing is', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const channel = privateChannel()
    const a = makeRuntime({ server, env, idb, extra: { BroadcastChannel: channel } })
    const b = makeRuntime({ server, env, idb, extra: { BroadcastChannel: channel } })
    await signIn(a)
    const idle = await ask(channel.channelName, 200)
    expect(idle.length).toBeGreaterThan(0)
    expect(idle.every(x => x.safe)).toBe(true)

    server.state.offline = true
    await a.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(a)
    const store = (await a.storeForDiagnostics())!
    await until(async () => (await store.dump()).outbox.some(r => (r as { state: string }).state === 'sending'))
    const answers = await ask(channel.channelName)
    expect(answers.some(x => x.safe === false)).toBe(true)
    expect(await b.updateSafe()).toBe(false)
    expect(await a.updateSafe()).toBe(false)

    server.state.offline = false
    a.commands.syncNow()
    await settle(a)
    expect(await a.updateSafe()).toBe(true)
    expect((await ask(channel.channelName, 200)).every(x => x.safe)).toBe(true)
    a.dispose()
    b.dispose()
  })
})
