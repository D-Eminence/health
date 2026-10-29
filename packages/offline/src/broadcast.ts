/**
 * Cross-tab messages on BroadcastChannel `health-id-offline` (§2.6, §2.12):
 * lock (keys dropped in every tab), outbox-changed (the sender re-reads),
 * wipe, and the shell's update-safe query (amendment A7: a tab whose outbox
 * has a command in state `sending` answers `safe:false`; no answer within
 * 500 ms means nothing is sending).
 * Messages carry ids only, never content.
 */

import { CHANNEL, type UpdateSafeAnswer, type UpdateSafeQuery } from './contracts'

export type OfflineMessage =
  | { type: 'lock'; reason: string }
  | { type: 'outbox-changed'; vaultId: string }
  | { type: 'wipe'; reason: string }
  | UpdateSafeQuery
  | UpdateSafeAnswer
  | { type: 'summary-changed' }

type ChannelCtor = new (name: string) => BroadcastChannel

export class OfflineBroadcast {
  private readonly channel: BroadcastChannel | null
  private readonly listeners = new Set<(m: OfflineMessage) => void>()

  constructor(ctor: ChannelCtor | null | undefined = globalThis.BroadcastChannel) {
    this.channel = ctor ? new ctor(CHANNEL) : null
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent) => {
        const m = event.data as OfflineMessage | null
        if (!m || typeof m !== 'object' || typeof m.type !== 'string') return
        for (const l of [...this.listeners]) l(m)
      }
    }
  }

  post(m: OfflineMessage): void {
    try { this.channel?.postMessage(m) } catch { /* closed */ }
  }

  on(listener: (m: OfflineMessage) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Answer every update-safe query (A7) with `safe: !(await sending())`. Returns the unsubscribe. */
  answerUpdateSafe(sending: () => Promise<boolean>): () => void {
    return this.on(m => {
      if (m.type !== 'update-safe-query' || typeof m.id !== 'string') return
      void sending().catch(() => true).then(busy => this.post({ type: 'update-safe', id: m.id, safe: !busy }))
    })
  }

  /** Ask the other tabs (A7). True when none answers `safe:false` within `waitMs`. */
  async othersSafe(waitMs = 500): Promise<boolean> {
    if (!this.channel) return true
    const id = globalThis.crypto.randomUUID()
    let safe = true
    const off = this.on(m => { if (m.type === 'update-safe' && m.id === id && m.safe === false) safe = false })
    this.post({ type: 'update-safe-query', id })
    await new Promise(resolve => setTimeout(resolve, waitMs))
    off()
    return safe
  }

  close(): void {
    this.listeners.clear()
    try { this.channel?.close() } catch { /* closed */ }
  }
}
