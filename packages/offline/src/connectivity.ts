/**
 * Connectivity (§2.8 eligibility, sync summary): `online`, `slow`,
 * `reconnecting` or `offline`, from every response the HTTP client reports
 * (onResponseMeta) plus a `GET /api/v1/ehr/offline/ping` probe: every 30 s
 * while reachable, backing off from 15 s to 60 s while offline. A 3-sample
 * debounce keeps a flapping link from bouncing the state.
 */

import { OFFLINE_PATHS, type Connectivity, type ResponseMeta } from './contracts'
import type { OfflineTransport } from './types'

export const PROBE_ONLINE_MS = 30_000
export const PROBE_OFFLINE_MIN_MS = 15_000
export const PROBE_OFFLINE_MAX_MS = 60_000
export const SLOW_MS = 3_000
const SAMPLES = 3

export type Sample = 'ok' | 'slow' | 'fail'

/** A response that proves the API is unreachable: no answer, or the Worker's 502 `API_ORIGIN_UNAVAILABLE`. */
export function sampleOf(meta: ResponseMeta): Sample | null {
  if (meta.networkError || meta.status === null) return 'fail'
  if (meta.status === 502 && (meta.code === 'API_ORIGIN_UNAVAILABLE' || !meta.problem)) return 'fail'
  if (meta.status === 503 || meta.status === 504) return 'fail'
  return 'ok'
}

/** The debounce, pure: the new state from the old one and the last samples (newest last). */
export function nextState(current: Connectivity, samples: readonly Sample[]): Connectivity {
  const last = samples.slice(-SAMPLES)
  const latest = last[last.length - 1]
  if (!latest) return current
  const all = (s: Sample) => last.length === SAMPLES && last.every(x => x === s)
  if (latest === 'fail') {
    if (all('fail')) return 'offline'
    return current === 'offline' ? 'offline' : 'reconnecting'
  }
  // A success.
  if (current === 'offline' || current === 'reconnecting') {
    return last.length === SAMPLES && last.every(x => x !== 'fail') ? (all('slow') ? 'slow' : 'online') : 'reconnecting'
  }
  if (all('slow')) return 'slow'
  if (latest === 'ok') return 'online'
  return current
}

export interface ConnectivityDeps {
  readonly transport: OfflineTransport
  readonly mono?: () => number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (h: unknown) => void
  readonly onChange: (state: Connectivity, previous: Connectivity) => void
  /** The probe's server time, for the sign-in clock. */
  readonly onServerTime?: (iso: string) => void
  readonly initial?: Connectivity
}

export class ConnectivityMonitor {
  private state: Connectivity
  private samples: Sample[] = []
  private timer: unknown = null
  private offlineDelay = PROBE_OFFLINE_MIN_MS
  private stopped = true
  private probing = false

  constructor(private readonly deps: ConnectivityDeps) {
    this.state = deps.initial ?? 'online'
  }

  current(): Connectivity {
    return this.state
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(this.state === 'offline' ? this.offlineDelay : PROBE_ONLINE_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) (this.deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer)
    this.timer = null
  }

  /** From the HTTP client. The probe's own responses are counted by `probe()`, not here. */
  observe(meta: ResponseMeta): void {
    if (meta.path === OFFLINE_PATHS.ping) return
    const s = sampleOf(meta)
    if (s) this.push(s)
  }

  /** The browser's own `offline` and `online` events: probe at once. */
  hint(): void {
    void this.probe()
  }

  private push(s: Sample): void {
    this.samples = [...this.samples, s].slice(-SAMPLES)
    const prev = this.state
    const next = nextState(prev, this.samples)
    if (next !== prev) {
      this.state = next
      if (next === 'online' || next === 'slow') this.offlineDelay = PROBE_OFFLINE_MIN_MS
      this.deps.onChange(next, prev)
    }
    // Leaving offline: take the remaining debounce samples quickly instead of waiting a full interval.
    if (!this.stopped && this.state === 'reconnecting') this.schedule(1_000)
  }

  async probe(): Promise<Connectivity> {
    if (this.probing) return this.state
    this.probing = true
    const mono = this.deps.mono ?? (() => globalThis.performance.now())
    const started = mono()
    try {
      const res = await this.deps.transport({ method: 'GET', path: OFFLINE_PATHS.ping, auth: 'none', timeoutMs: 10_000 })
      const body = res.body as { serverTime?: unknown } | null
      if (typeof body?.serverTime === 'string') this.deps.onServerTime?.(body.serverTime)
      this.push(mono() - started > SLOW_MS ? 'slow' : 'ok')
    } catch {
      this.push('fail')
    } finally {
      this.probing = false
    }
    if (!this.stopped && this.state !== 'reconnecting') {
      if (this.state === 'offline') {
        this.schedule(this.offlineDelay)
        this.offlineDelay = Math.min(PROBE_OFFLINE_MAX_MS, this.offlineDelay * 2)
      } else {
        this.schedule(PROBE_ONLINE_MS)
      }
    }
    return this.state
  }

  private schedule(ms: number): void {
    const set = this.deps.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t))
    const clear = this.deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
    if (this.timer !== null) clear(this.timer)
    this.timer = set(() => { this.timer = null; void this.probe() }, ms)
  }
}
