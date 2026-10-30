/**
 * Storage health (sync summary `storage`): ask for persistent storage once,
 * then read `navigator.storage.estimate()` every 10 minutes. Low when less
 * than 200 MB is free or more than 80% of the quota is used.
 */

export const STORAGE_CHECK_MS = 10 * 60_000
export const LOW_FREE_BYTES = 200 * 1024 * 1024
export const LOW_USED_RATIO = 0.8

export interface StorageState { usageBytes: number | null; quotaBytes: number | null; persisted: boolean | null; low: boolean }

export function isLow(usage: number | null, quota: number | null): boolean {
  if (usage === null || quota === null || quota <= 0) return false
  return quota - usage < LOW_FREE_BYTES || usage / quota > LOW_USED_RATIO
}

type StorageLike = Pick<StorageManager, 'estimate'> & Partial<Pick<StorageManager, 'persist' | 'persisted'>>

export class StorageHealth {
  private state: StorageState = { usageBytes: null, quotaBytes: null, persisted: null, low: false }
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly storage: StorageLike | null | undefined, private readonly onChange: () => void) {}

  current(): StorageState {
    return this.state
  }

  /** Ask for persistent storage (after a vault is created or opened). */
  async persist(): Promise<boolean | null> {
    if (!this.storage?.persist) return null
    try {
      const persisted = await this.storage.persist()
      this.state = { ...this.state, persisted }
      this.onChange()
      return persisted
    } catch {
      return null
    }
  }

  async check(): Promise<StorageState> {
    if (!this.storage) return this.state
    try {
      const e = await this.storage.estimate()
      const usage = e.usage ?? null
      const quota = e.quota ?? null
      const persisted = this.storage.persisted ? await this.storage.persisted() : this.state.persisted
      this.state = { usageBytes: usage, quotaBytes: quota, persisted, low: isLow(usage, quota) }
      this.onChange()
    } catch {
      // Keep the last known state.
    }
    return this.state
  }

  start(): void {
    if (this.timer) return
    void this.check()
    this.timer = setInterval(() => { void this.check() }, STORAGE_CHECK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
