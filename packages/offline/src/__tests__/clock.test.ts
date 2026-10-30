import { describe, expect, it } from 'vitest'
import { TrustedClock } from '../clock'
import { LIMITS } from '../contracts'
import { leaseUntil, leaseVerdict, touchLease } from '../lease'

const T0 = Date.parse('2026-10-29T09:00:00.000Z')

function clockAt() {
  const env = { wall: T0, mono: 0 }
  return { env, clock: new TrustedClock({ wall: () => env.wall, mono: () => env.mono }) }
}

describe('trusted clock', () => {
  it('uses the wall clock plus the stored offset until anchored', () => {
    const { env, clock } = clockAt()
    clock.restore({ offsetMs: 5000, lastWallSeen: 0 })
    expect(clock.state()).toBe('wall')
    expect(clock.now()).toBe(env.wall + 5000)
  })

  it('anchors on a server Date and runs on the monotonic clock', () => {
    const { env, clock } = clockAt()
    clock.observe(new Date(T0 + 60_000).toUTCString())
    expect(clock.state()).toBe('anchored')
    env.mono += 10_000
    env.wall += 10_000
    expect(clock.now()).toBe(T0 + 70_000)
  })

  it('a rollback after anchoring never shortens time and is suspect past 5 minutes', () => {
    const { env, clock } = clockAt()
    clock.observe(new Date(T0).toUTCString())
    env.mono += 1000
    env.wall -= 10 * 60_000
    expect(clock.now()).toBe(T0 + 1000)
    expect(clock.state()).toBe('suspect')
  })

  it('a rollback against lastWallSeen (no anchor) is suspect', () => {
    const { env, clock } = clockAt()
    clock.noteWall()
    env.wall -= LIMITS.clockRollbackMs - 1
    expect(clock.state()).toBe('wall')
    env.wall -= 2
    expect(clock.state()).toBe('suspect')
  })

  it('a forward jump makes time later (a lease can only look shorter)', () => {
    const { env, clock } = clockAt()
    clock.observe(new Date(T0).toUTCString())
    env.wall += 3600_000
    expect(clock.now()).toBe(T0 + 3600_000)
    expect(clock.state()).toBe('anchored')
  })
})

describe('lease', () => {
  it('is min(last contact + 8 h, sign-in + 24 h)', () => {
    expect(leaseUntil(T0, T0)).toBe(T0 + LIMITS.leaseMs)
    expect(leaseUntil(T0 + 20 * 3600_000, T0)).toBe(T0 + LIMITS.absoluteMs)
  })

  it('moves forward on contact and never backwards', () => {
    const l = { signedInAt: T0, lastServerContactAt: T0, leaseUntil: leaseUntil(T0, T0) }
    const later = touchLease(l, T0 + 3600_000)
    expect(later.leaseUntil).toBe(T0 + 3600_000 + LIMITS.leaseMs)
    expect(touchLease(later, T0).lastServerContactAt).toBe(T0 + 3600_000)
  })

  it('refuses at or after the lease, or with a suspect clock', () => {
    const until = T0 + LIMITS.leaseMs
    expect(leaseVerdict(until, until - 1, 'anchored')).toBe('ok')
    expect(leaseVerdict(until, until, 'wall')).toBe('lease-expired')
    expect(leaseVerdict(until, T0, 'suspect')).toBe('clock-suspect')
  })
})
