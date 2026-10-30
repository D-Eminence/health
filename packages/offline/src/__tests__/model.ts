/**
 * Model-based randomised test of the vault, session and retention state machine (coordinator round 4).
 *
 * A seeded generator drives 2 accounts × 2 facilities × 2 tabs on one IndexedDB through sign-in (online and
 * offline), sign-out, lock and unlock (right, wrong, parallel), every wipe reason, membership end, password change,
 * escrow and C2 outages, saves, reads, discards, the kill switch, reloads and server-time jumps. A small model checks
 * after every step:
 *  I1  no queued, sending, review or held command is lost, except by D9 (membership ended); at the end every one is
 *      sent once its owner signs in again;
 *  I2  after a sign-out or a wipe, that account has no readable copy until an online sign-in;
 *  I3  an opened vault belongs to the account (and facility) that opened it;
 *  I4  sequential, single tab: fewer than 5 wrong guesses never wipe a readable copy; the 5th does;
 *  I5  an offline-open audit event is never lost before it is acknowledged, except under the A9.2 abandoned rule.
 * A failure names the seed and the steps taken, so it can be replayed and kept as a fixed regression test.
 */

import { IDBFactory } from 'fake-indexeddb'
import { LIMITS, type StaffSessionSnapshot, type WipeReason } from '../contracts'
import type { OfflineRuntimeHandle } from '../runtime'
import { createMemoryLocks } from '../testing'
import { OTHER_FACILITY, SESSION } from './fixtures'
import { createServer, makeRuntime, privateChannel, serverContact, settle, signIn, until, type Env } from './harness'

type Acc = 'A' | 'B'
type Fac = 'X' | 'Y'
const ACCS: Acc[] = ['A', 'B']
const FACS: Fac[] = ['X', 'Y']
const FACILITY: Record<Fac, string> = { X: SESSION.facilityId, Y: OTHER_FACILITY }
const ACCOUNT: Record<Acc, { accountId: string; membershipId: string; email: string }> = {
  A: { accountId: 'acc-a', membershipId: 'mem-a', email: 'nurse.a@demo.example' },
  B: { accountId: 'acc-b', membershipId: 'mem-b', email: 'nurse.b@demo.example' },
}
const DAY = 86400_000
const WIPES: WipeReason[] = ['sign-out', 'failed-unlocks', 'lease', 'membership', 'kill-switch', 'account']

function session(acc: Acc, fac: Fac): StaffSessionSnapshot {
  return { ...SESSION, ...ACCOUNT[acc], facilityId: FACILITY[fac], facilityName: `Facility ${fac}` }
}

/** mulberry32: small, fast, seedable. */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  }
}

interface Tab {
  rt: OfflineRuntimeHandle
  /** The account and facility of the vault this tab has open (readable), if any. */
  open: { acc: Acc; fac: Fac } | null
  /** The last vault owner this tab opened (survives a lock), and the session attached online. */
  lastOwner: { acc: Acc; fac: Fac } | null
  attached: { acc: Acc; fac: Fac } | null
  /** The step at which `attached` was verified by the server. */
  attachedStep: number
}

interface Token { acc: Acc; fac: Fac; commandId: string | null; status: 'pending' | 'discarded' | 'exempt' }

export class ModelViolation extends Error {}

export async function runSequence(seed: number, steps: number): Promise<void> {
  const r = rng(seed)
  const log: string[] = []
  const fail = (message: string): never => {
    throw new ModelViolation(`seed ${seed}: ${message}\nsteps:\n  ${log.join('\n  ')}`)
  }
  const server = createServer()
  const env: Env = { wall: Date.parse('2026-10-29T09:00:00.000Z'), mono: 1_000_000, serverClock: true }
  const idb = new IDBFactory()
  const locks = createMemoryLocks()
  const channel = privateChannel()
  let killSwitch = false
  const passwords: Record<Acc, string[]> = { A: ['alpha password one'], B: ['bravo password one'] }
  const pw = (acc: Acc) => passwords[acc][passwords[acc].length - 1]!
  const tokens = new Map<string, Token>()
  const byCommand = new Map<string, string>()
  /** `acc:fac` vaults with no readable copy until an online sign-in opens them again. */
  const noReadable = new Set<string>()
  const key = (acc: Acc, fac: Fac) => `${acc}:${fac}`
  const allGone = () => { for (const a of ACCS) for (const f of FACS) noReadable.add(key(a, f)) }
  /** `wiped` also answers a signed-out vault; only an attempt at the counter's limit wiped every readable copy. */
  const wipedAll = async () => {
    const meta = (await dump())?.meta[0] as { failedUnlocks: number } | undefined
    if ((meta?.failedUnlocks ?? 0) >= LIMITS.maxFailedUnlocks) allGone()
  }
  let wrong = 0
  let exact = true
  let reads: { patient: string; forgiven: boolean }[] = []
  let n = 0

  const extra = () => ({
    env: { mode: killSwitch ? 'off' : 'pilot', facilities: `${FACILITY.X},${FACILITY.Y}`, hosts: 'ehr' },
    BroadcastChannel: channel,
  })
  const fresh = (): OfflineRuntimeHandle => makeRuntime({ server, env, idb, locks, extra: extra() })
  const tabs: Tab[] = [0, 1].map(() => ({ rt: fresh(), open: null, lastOwner: null, attached: null, attachedStep: -1 }))
  /** `acc:fac` → the step its membership ended (D9); cleared by a later server-verified session there. */
  const membershipEnded = new Map<string, number>()
  let stepNo = 0
  server.state.offline = r.chance(0.5)
  const store = async () => (await tabs[0]!.rt.storeForDiagnostics()) ?? (await tabs[1]!.rt.storeForDiagnostics())
  const dump = async () => (await store())?.dump() ?? null

  const sync = (t: Tab) => {
    // A tab locked or wiped by another tab (broadcast) no longer has a vault open.
    if (t.open && t.rt.summary().vault !== 'unlocked') t.open = null
  }

  /** I3: the vault this tab opened is the account's own, at the expected facility. */
  const checkOpened = (t: Tab, acc: Acc, fac: Fac | null) => {
    const s = t.rt.restoreSession()
    if (!s) return false
    if (s.accountId !== ACCOUNT[acc].accountId) fail(`I3: ${acc} opened a vault of ${s.accountId}`)
    const actualFac = (Object.keys(FACILITY) as Fac[]).find(f => FACILITY[f] === s.facilityId)!
    if (fac !== null && actualFac !== fac) fail(`I3: ${acc} at ${fac} opened a vault for ${actualFac}`)
    t.open = { acc, fac: actualFac }
    t.lastOwner = t.open
    return true
  }

  const appliedTokens = () => new Set(server.applied.flatMap(b => {
    const m = /"reason":"(t\d+)"/.exec(b)
    return m ? [m[1]!] : []
  }))

  /** I1 (each step): the unfinished outbox records cover every tracked pending command not applied on the server. */
  type Dump = Awaited<ReturnType<typeof dump>>
  const checkI1 = async (d: Dump) => {
    if (!d) return
    const unfinished = (d.outbox as { state: string }[]).filter(o => o.state !== 'applied' && o.state !== 'discarded').length
    const applied = appliedTokens()
    const owed = [...tokens.entries()].filter(([tok, t]) => t.status === 'pending' && !applied.has(tok)).length
    if (unfinished < owed) fail(`I1: ${owed} pending commands not applied, but only ${unfinished} unfinished records`)
  }

  /** I5: offline opens not acknowledged are still in the audit store. */
  const checkI5 = async (d: Dump) => {
    const acked = new Set(server.audit.flatMap(b => b.events.filter(e => e.action === 'ehr.record.read')
      .map(e => (e as unknown as { patientId: string }).patientId)))
    const owed = reads.filter(x => !x.forgiven && !acked.has(x.patient)).length
    const stored = d ? d.audit.length : 0
    if (stored < owed) fail(`I5: ${owed} offline opens not acknowledged, but only ${stored} audit records stored`)
  }

  /** I2: a probe with the right password finds nothing readable for an account that signed out or was wiped. */
  const checkI2 = async (acc: Acc) => {
    if (killSwitch || !FACS.some(f => noReadable.has(key(acc, f)))) return
    const probe = fresh()
    const res = await probe.unlockOffline(ACCOUNT[acc].email, pw(acc))
    if (res.ok) {
      const s = probe.restoreSession()!
      const fac = FACS.find(f => FACILITY[f] === s.facilityId)!
      if (noReadable.has(key(acc, fac))) fail(`I2: ${acc}@${fac} has a readable copy after sign-out or wipe`)
    }
    probe.dispose()
    exact = false
  }

  const doSignIn = async (t: Tab, acc: Acc, fac: Fac, optIn: boolean) => {
    server.state.account = ACCOUNT[acc].accountId
    await signIn(t.rt, { server, session: session(acc, fac), password: pw(acc), optIn })
    t.attached = { acc, fac }
    t.attachedStep = stepNo
    membershipEnded.delete(key(acc, fac))
    // A send-only vault (kill switch) has no readable session, but this tab is still its owner (wipe(membership)).
    if (t.rt.summary().vault === 'unlocked') t.lastOwner = { acc, fac }
    if (checkOpened(t, acc, fac)) {
      // A server-verified sign-in that opened a vault clears the counter and restores this account's copy.
      wrong = 0
      exact = true
      noReadable.delete(key(acc, fac))
    } else {
      t.open = null
    }
  }

  const unlockResult = async (t: Tab, acc: Acc, right: boolean, how: 'offline' | 'locked') => {
    const password = right ? pw(acc) : `wrong ${n} password`
    const res = how === 'offline' ? await t.rt.unlockOffline(ACCOUNT[acc].email, password) : await t.rt.unlockLocked(password)
    if (res.ok) {
      if (!right) fail('a wrong password unlocked')
      // D9: the lock overlay never reopens a vault whose membership ended after this tab's session was verified.
      if (how === 'locked' && t.attached) {
        const e = membershipEnded.get(key(t.attached.acc, t.attached.fac))
        if (e !== undefined && e >= t.attachedStep) fail(`D9: ${t.attached.acc}@${t.attached.fac} reopened by the lock overlay after its membership ended`)
      }
      // An online-reload unlock is a server-verified session (A9.2); an offline unlock must find a readable copy.
      if (checkOpened(t, acc, null) && how === 'offline' && noReadable.has(key(acc, t.open!.fac)) && !killSwitch) {
        fail(`I2: ${acc}@${t.open!.fac} unlocked offline after sign-out or wipe`)
      }
      exact = false
    } else if (!right) {
      // Only a guess that was counted (it reserved an attempt) answers wrong-credentials or wiped.
      if ((res.reason === 'wrong-credentials' || res.reason === 'wiped') && !killSwitch) {
        wrong += 1
        // I4: a readable copy is wiped only at the fifth wrong guess, and, counted exactly, at the fifth.
        if (res.reason === 'wiped' && wrong < LIMITS.maxFailedUnlocks && exact) fail(`I4: wiped after ${wrong} wrong guesses`)
        if (exact && wrong === LIMITS.maxFailedUnlocks && res.reason !== 'wiped') fail('I4: the 5th wrong guess did not wipe')
      }
    } else {
      exact = false
    }
    if (!res.ok && res.reason === 'wiped') await wipedAll()
    return res
  }

  const ops: { w: number; run: () => Promise<string | null> }[] = [
    { w: 6, run: async () => {
      const t = r.pick(tabs), acc = r.pick(ACCS), fac = r.pick(FACS), optIn = r.chance(0.8)
      await doSignIn(t, acc, fac, optIn)
      return `signIn tab${tabs.indexOf(t)} ${acc}@${fac} optIn=${optIn}`
    } },
    { w: 3, run: async () => {
      const t = r.pick(tabs), online = r.chance(0.5)
      const who = t.open
      await t.rt.signOut({ online })
      if (who) noReadable.add(key(who.acc, who.fac))
      t.open = null
      t.attached = null
      if (!online) await t.rt.logoutSent()
      return `signOut tab${tabs.indexOf(t)} online=${online}`
    } },
    { w: 3, run: async () => {
      const t = r.pick(tabs)
      t.rt.lock('manual')
      for (const x of tabs) sync(x)
      return `lock tab${tabs.indexOf(t)}`
    } },
    { w: 4, run: async () => {
      const t = r.pick(tabs), acc = t.attached?.acc ?? t.lastOwner?.acc ?? r.pick(ACCS), right = r.chance(0.6)
      if (t.open) return null
      const res = await unlockResult(t, acc, right, 'locked')
      return `unlockLocked tab${tabs.indexOf(t)} ${acc} right=${right} -> ${res.ok ? 'ok' : res.reason}`
    } },
    { w: 4, run: async () => {
      const t = r.pick(tabs), acc = r.pick(ACCS), right = r.chance(0.5)
      if (t.open) return null
      const res = await unlockResult(t, acc, right, 'offline')
      return `unlockOffline tab${tabs.indexOf(t)} ${acc} right=${right} -> ${res.ok ? 'ok' : res.reason}`
    } },
    { w: 1, run: async () => {
      // Parallel attempts in both tabs: not counted exactly.
      exact = false
      const acc = r.pick(ACCS)
      const res = await Promise.all(tabs.map(t => (t.open ? null : t.rt.unlockOffline(ACCOUNT[acc].email, r.chance(0.5) ? pw(acc) : 'parallel wrong one'))))
      for (const [i, x] of res.entries()) if (x?.ok) checkOpened(tabs[i]!, acc, null)
      if (res.some(x => x && !x.ok && x.reason === 'wiped')) await wipedAll()
      return `parallel unlockOffline ${acc} -> ${res.map(x => (x ? (x.ok ? 'ok' : x.reason) : '-')).join(',')}`
    } },
    { w: 2, run: async () => {
      const t = r.pick(tabs), reason = r.chance(0.4) ? 'membership' : r.pick(WIPES)
      const who = t.open
      const owner = t.open ?? t.lastOwner
      const ended = t.attached ?? owner
      await t.rt.wipe(reason)
      if (reason === 'failed-unlocks' || reason === 'kill-switch') allGone()
      else if (who && reason !== 'membership') noReadable.add(key(who.acc, who.fac))
      if (reason === 'membership' && owner && ended && owner.acc === ended.acc && owner.fac === ended.fac) {
        // D9: this person's queued work at that facility may be deleted 30 days later.
        for (const tok of tokens.values()) if (tok.acc === owner.acc && tok.fac === owner.fac && tok.status === 'pending') tok.status = 'exempt'
        membershipEnded.set(key(owner.acc, owner.fac), stepNo)
        noReadable.add(key(owner.acc, owner.fac))
      }
      for (const x of tabs) sync(x)
      t.open = null
      return `wipe tab${tabs.indexOf(t)} ${reason}`
    } },
    { w: 1, run: async () => {
      const acc = r.pick(ACCS)
      passwords[acc].push(`${pw(acc)} changed`)
      return `password change ${acc}`
    } },
    { w: 3, run: async () => {
      const which = r.pick(['escrow', 'auditDown', 'offline', 'offline'] as const)
      if (which === 'escrow') server.state.escrow = !server.state.escrow
      else if (which === 'auditDown') server.state.auditDown = !server.state.auditDown
      else server.state.offline = !server.state.offline
      return `toggle ${which}`
    } },
    { w: 6, run: async () => {
      const t = r.pick(tabs)
      sync(t)
      if (!t.open || killSwitch) return null
      n += 1
      const tok = `t${n}`
      if (r.chance(0.15)) server.failWhenBody(tok, { status: 412, code: 'VERSION_CONFLICT' })
      try {
        const out = await t.rt.commands.save('ehr.encounter.create', { patientId: `p-${tok}`, text: tok }, { awaitMs: 0 })
        tokens.set(tok, { ...t.open, commandId: out.kind === 'saved' ? out.commandId : null, status: out.kind === 'saved' ? 'pending' : 'discarded' })
        if (out.kind === 'saved') byCommand.set(out.commandId, tok)
        return `save tab${tabs.indexOf(t)} ${tok} -> ${out.kind}`
      } catch (error) {
        return `save tab${tabs.indexOf(t)} ${tok} -> refused (${(error as Error).name})`
      }
    } },
    { w: 3, run: async () => {
      const t = r.pick(tabs)
      sync(t)
      if (!t.open) return null
      n += 1
      const patient = `read-${n}`
      const before = (await dump())?.audit.length ?? 0
      const ackedThis = () => server.audit.some(b => b.events.some(e => (e as unknown as { patientId: string }).patientId === patient))
      t.rt.audit.recordOpen(patient, 'encounters')
      try {
        // Recorded: the store grew, or this patient's own event was already acknowledged (not another read's).
        await until(async () => ackedThis() || ((await dump())?.audit.length ?? 0) > before, 1000)
        reads.push({ patient, forgiven: false })
      } catch { /* not recorded (locked meanwhile) */ }
      return `read tab${tabs.indexOf(t)} ${patient}`
    } },
    { w: 1, run: async () => {
      const t = r.pick(tabs)
      if (!t.open) return null
      const items = await t.rt.review.list()
      const item = items[0]
      if (!item || !item.class || !['CC2', 'CC3', 'CC5', 'CC7', 'CC4'].includes(item.class)) return null
      await t.rt.review.resolve(item.commandId, 'discard', { reason: 'Recorded elsewhere already' })
      const tok = byCommand.get(item.commandId)
      if (tok) tokens.get(tok)!.status = 'discarded'
      return `discard tab${tabs.indexOf(t)} ${tok ?? item.commandId}`
    } },
    { w: 2, run: async () => {
      // A sign-in left at MFA by one account, then another account's session becomes ready in that tab.
      const t = r.pick(tabs), a1 = r.pick(ACCS), a2 = a1 === 'A' ? 'B' : 'A', fac = r.pick(FACS)
      t.rt.prepareFromSignIn(ACCOUNT[a1].email, pw(a1))
      server.state.account = ACCOUNT[a2].accountId
      serverContact(t.rt)
      await t.rt.attachSession(session(a2, fac), { optIn: r.chance(0.8), online: true })
      t.rt.setSessionReady(true)
      t.attached = { acc: a2, fac }
      t.attachedStep = stepNo
      membershipEnded.delete(key(a2, fac))
      // Whatever opened must be a2's own vault, keyed by a2 (I3); nothing may be keyed by a1's password.
      if (t.rt.summary().vault === 'unlocked') t.lastOwner = { acc: a2, fac }
      if (t.rt.restoreSession()) checkOpened(t, a2, fac)
      else t.open = null
      return `MFA left by ${a1}, session ready for ${a2}@${fac} in tab${tabs.indexOf(t)}`
    } },
    { w: 2, run: async () => {
      // An online reload: the session is verified again, no password in this tab.
      const t = r.pick(tabs), acc = r.pick(ACCS), fac = r.pick(FACS)
      t.rt.dispose()
      t.rt = fresh()
      t.open = null
      t.lastOwner = null
      server.state.account = ACCOUNT[acc].accountId
      serverContact(t.rt)
      await t.rt.attachSession(session(acc, fac), { optIn: false, online: true })
      t.rt.setSessionReady(true)
      t.attached = { acc, fac }
      t.attachedStep = stepNo
      membershipEnded.delete(key(acc, fac))
      return `online reload tab${tabs.indexOf(t)} as ${acc}@${fac}`
    } },
    { w: 1, run: async () => {
      killSwitch = !killSwitch
      for (const t of tabs) {
        t.rt.dispose()
        t.rt = fresh()
        t.open = null
        t.attached = null
        t.lastOwner = null
        await t.rt.ready()
      }
      if (killSwitch) allGone()
      return `kill switch ${killSwitch ? 'on' : 'off'}`
    } },
    { w: 2, run: async () => {
      const t = r.pick(tabs)
      t.rt.dispose()
      t.rt = fresh()
      t.open = null
      t.attached = null
      t.attachedStep = -1
      t.lastOwner = null
      return `reload tab${tabs.indexOf(t)}`
    } },
    { w: 3, run: async () => {
      const ms = r.pick([60_000, 10 * 60_000, 3600_000, 9 * 3600_000, 2 * DAY, 29 * DAY, 31 * DAY, 31 * DAY, 40 * DAY])
      env.wall += ms
      env.mono += ms
      if (ms >= 29 * DAY) reads = reads.map(x => ({ ...x, forgiven: true }))
      for (const t of tabs) {
        await t.rt.tick()
        sync(t)
      }
      return `time +${Math.round(ms / 60_000)} min`
    } },
    { w: 1, run: async () => {
      // Pump the outbox and audit of whichever tabs are open.
      for (const t of tabs) {
        t.rt.commands.syncNow()
        await settle(t.rt)
      }
      return 'sync'
    } },
  ]
  const total = ops.reduce((a, o) => a + o.w, 0)

  for (let step = 0; step < steps; step += 1) {
    stepNo = step
    let x = r.int(total)
    const op = ops.find(o => (x -= o.w) < 0)!
    let line: string | null = null
    try {
      line = await op.run()
    } catch (error) {
      if (error instanceof ModelViolation) throw error
      fail(`step threw: ${(error as Error).stack ?? String(error)}`)
    }
    if (line === null) continue
    log.push(line)
    for (const t of tabs) sync(t)
    const d = await dump()
    await checkI1(d)
    await checkI5(d)
    if (r.chance(0.2)) await checkI2(r.pick(ACCS))
  }

  // Drain: everything up, the kill switch off; every owner signs in at every facility with each password they ever
  // had (oldest first), so any vault still holding work is opened and sent. Then every pending command is applied.
  log.push('-- drain --')
  server.state.escrow = true
  server.state.auditDown = false
  server.state.offline = false
  killSwitch = false
  for (const t of tabs) t.rt.dispose()
  for (const acc of ACCS) {
    for (const fac of FACS) {
      for (const password of passwords[acc]) {
        const rt = fresh()
        server.state.account = ACCOUNT[acc].accountId
        rt.prepareFromSignIn(ACCOUNT[acc].email, password)
        serverContact(rt)
        await rt.logoutSent()
        await rt.attachSession(session(acc, fac), { optIn: false, online: true })
        rt.setSessionReady(true)
        // Until this owner's pending commands at this facility are sent (a loaded machine needs more rounds).
        const owedHere = () => {
          const applied = appliedTokens()
          return [...tokens.entries()].some(([tok, t]) => t.acc === acc && t.fac === fac && t.status === 'pending' && !applied.has(tok))
        }
        for (let i = 0; i < 8; i += 1) {
          rt.commands.syncNow()
          await settle(rt)
          if (!owedHere()) break
        }
        for (const item of await rt.review.list()) {
          if (['CC2', 'CC3', 'CC5', 'CC7', 'CC4'].includes(item.class)) {
            await rt.review.resolve(item.commandId, 'discard', { reason: 'Drained by the model test' }).catch(() => undefined)
            const tok = byCommand.get(item.commandId)
            if (tok) tokens.get(tok)!.status = 'discarded'
          }
        }
        rt.dispose()
      }
    }
  }
  const applied = appliedTokens()
  const lost = [...tokens.entries()].filter(([tok, t]) => t.status === 'pending' && !applied.has(tok)).map(([tok]) => tok)
  if (lost.length > 0) fail(`I1 (drain): commands never sent: ${lost.join(', ')}`)
}
