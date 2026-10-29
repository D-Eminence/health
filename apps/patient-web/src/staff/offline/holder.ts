import type { OfflineRuntime } from '@hid/offline'

/**
 * The offline runtime, for pages that must not load the staff API module themselves (the sign-in page). runtime.ts
 * provides it when the workspace loads; before that, and in a page without the workspace, there is none.
 */
let provide: (() => OfflineRuntime | null) | null = null

export function provideOfflineRuntime(source: () => OfflineRuntime | null): void {
  provide = source
}

export function currentOfflineRuntime(): OfflineRuntime | null {
  return provide?.() ?? null
}
