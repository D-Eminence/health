/**
 * Cross-tab messages on BroadcastChannel `health-id-offline` (§2.6, §2.12):
 * lock (keys dropped in every tab), outbox-changed (the sender re-reads),
 * wipe, and the shell's update-safe query (is any command on the wire?).
 * Messages carry ids only, never content.
 */

import { CHANNEL } from './contracts'

export type OfflineMessage =
  | { type: 'lock'; reason: string }
  | { type: 'outbox-changed'; vaultId: string }
  | { type: 'wipe'; reason: string }
  | { type: 'update-safe?'; id: string }
  | { type: 'update-safe!'; id: string; sending: number }
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

  /** Ask every other tab how many commands it has on the wire. Resolves after `waitMs`. */
  async othersSending(waitMs = 300): Promise<number> {
    if (!this.channel) return 0
    const id = globalThis.crypto.randomUUID()
    let total = 0
    const off = this.on(m => { if (m.type === 'update-safe!' && m.id === id) total += m.sending })
    this.post({ type: 'update-safe?', id })
    await new Promise(resolve => setTimeout(resolve, waitMs))
    off()
    return total
  }

  close(): void {
    this.listeners.clear()
    try { this.channel?.close() } catch { /* closed */ }
  }
}
