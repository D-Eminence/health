import { describe, expect, it } from 'vitest'
import { PATIENT } from './fixtures'
import { createServer, makeEnv, makeRuntime, settle, signIn, until } from './harness'

async function ready() {
  const server = createServer()
  const env = makeEnv()
  const rt = makeRuntime({ server, env })
  await signIn(rt)
  return { rt, env, server }
}

const wait = () => new Promise(r => setTimeout(r, 20))

describe('offline audit', () => {
  it('records opens with contiguous seq, merges within 10 minutes, and sends in batches of 20 (C2)', async () => {
    const { rt, env, server } = await ready()
    server.state.offline = true
    for (let i = 0; i < 25; i += 1) rt.audit.recordOpen(`patient-${i}`, 'encounters')
    rt.audit.recordOpen('patient-0', 'encounters') // merged
    env.mono += 1
    rt.audit.recordOpen('patient-0', 'not-a-section') // refused section
    const store = (await rt.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length >= 25)
    await wait()
    let dump = await store.dump()
    expect(dump.audit).toHaveLength(25)
    server.state.offline = false
    rt.commands.syncNow()
    await settle(rt)
    await wait()
    const batches = server.audit
    expect(batches.map(b => b.events.length)).toEqual([20, 5])
    const seqs = batches.flatMap(b => b.events.map(e => e.seq))
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
    expect(batches[0]!.events[0]).toMatchObject({ action: 'ehr.record.read', section: 'encounters', clock: 'wall' })
    expect(new Set(batches.flatMap(b => b.events.map(e => (e as unknown as { patientId: string }).patientId))).size).toBe(25)
    expect(JSON.stringify(batches[0]).length).toBeLessThan(8000)
    dump = await (await rt.storeForDiagnostics())!.dump()
    expect(dump.audit).toHaveLength(0)
  })

  it('keeps a rejected event (7 days, then dropped with a report) and deletes accepted ones', async () => {
    const reports: unknown[] = []
    const server = createServer()
    const env = makeEnv()
    const rt = makeRuntime({ server, env, extra: { report: e => reports.push(e) } })
    await signIn(rt)
    server.state.offline = true
    rt.audit.recordOpen(PATIENT, 'encounters')
    await wait()
    rt.audit.recordOpen(PATIENT, 'vitals')
    await wait()
    const store = (await rt.storeForDiagnostics())!
    server.state.offline = false
    server.state.auditReject.add(1)
    rt.commands.syncNow()
    await settle(rt)
    await wait()
    expect(server.audit.flatMap(b => b.events)).toHaveLength(2)
    let left = (await store.dump()).audit as { seq: number; state: string }[]
    expect(left.map(a => [a.seq, a.state])).toEqual([[1, 'rejected']])
    expect(rt.summary().pending).toBe(0)

    env.wall += 7 * 86400_000
    rt.commands.syncNow()
    await settle(rt)
    await wait()
    left = (await store.dump()).audit as { seq: number; state: string }[]
    expect(left).toHaveLength(0)
    expect(reports).toContainEqual({ kind: 'audit-rejected', dropped: 1, code: 'EXPIRED' })
  })
})
