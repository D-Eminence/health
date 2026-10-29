/**
 * Trusted time (§2.6).
 *
 * offset = Date(header) + rtt/2 − Date.now(), taken from every authenticated
 * response through onResponseMeta. The anchor `{serverMs, perf0}` lives in tab
 * memory only. trustedNow = max(serverMs + (performance.now() − perf0),
 * Date.now() + offset): taking the max means a lease can never look longer
 * than it is.
 *
 * States: `anchored` (this tab has seen a server Date), `wall` (no anchor; the
 * stored offset is used), `suspect` (the wall clock is more than 5 minutes
 * behind `lastWallSeen` or behind the anchor).
 */

import { LIMITS, type ClockState } from './contracts'

export interface ClockDeps {
  /** Date.now */
  readonly wall?: () => number
  /** performance.now */
  readonly mono?: () => number
}

export class TrustedClock {
  private readonly wall: () => number
  private readonly mono: () => number
  private anchor: { serverMs: number; perf0: number; offsetMs: number } | null = null
  private offsetMs: number
  private lastWallSeen: number

  constructor(deps: ClockDeps = {}, stored: { offsetMs?: number; lastWallSeen?: number } = {}) {
    this.wall = deps.wall ?? (() => Date.now())
    this.mono = deps.mono ?? (() => globalThis.performance.now())
    this.offsetMs = stored.offsetMs ?? 0
    this.lastWallSeen = stored.lastWallSeen ?? 0
  }

  /** Restore what the vault remembers (on unlock). Never moves `lastWallSeen` backwards. */
  restore(stored: { offsetMs: number; lastWallSeen: number }): void {
    if (!this.anchor) this.offsetMs = stored.offsetMs
    this.lastWallSeen = Math.max(this.lastWallSeen, stored.lastWallSeen)
  }

  /** A server `Date` header (from onResponseMeta). `rttMs` when known. */
  observe(dateHeader: string | null, rttMs = 0): void {
    if (!dateHeader) return
    const serverMs = Date.parse(dateHeader)
    if (!Number.isFinite(serverMs)) return
    const at = serverMs + rttMs / 2
    this.offsetMs = at - this.wall()
    this.anchor = { serverMs: at, perf0: this.mono(), offsetMs: this.offsetMs }
  }

  /** Every 60 s while unlocked, and before persisting the lease. */
  noteWall(): number {
    this.lastWallSeen = Math.max(this.lastWallSeen, this.wall())
    return this.lastWallSeen
  }

  now(): number {
    const byWall = this.wall() + this.offsetMs
    if (!this.anchor) return byWall
    return Math.max(this.anchor.serverMs + (this.mono() - this.anchor.perf0), byWall)
  }

  state(): ClockState {
    const wall = this.wall()
    if (this.lastWallSeen - wall > LIMITS.clockRollbackMs) return 'suspect'
    if (this.anchor) {
      const anchoredNow = this.anchor.serverMs + (this.mono() - this.anchor.perf0)
      if (anchoredNow - (wall + this.anchor.offsetMs) > LIMITS.clockRollbackMs) return 'suspect'
      return 'anchored'
    }
    return 'wall'
  }

  snapshot(): { offsetMs: number; lastWallSeen: number } {
    return { offsetMs: this.offsetMs, lastWallSeen: this.lastWallSeen }
  }

  anchored(): boolean {
    return this.anchor !== null
  }
}
