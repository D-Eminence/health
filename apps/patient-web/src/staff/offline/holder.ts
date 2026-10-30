import type { OfflineCore } from '@hid/offline'

/**
 * The offline runtime, for pages that must not load the staff API module themselves (the sign-in page). runtime.ts
 * provides it when the workspace loads; before that, and in a page without the workspace, there is none.
 */
let provide: (() => OfflineCore | null) | null = null

export function provideOfflineRuntime(source: () => OfflineCore | null): void {
  provide = source
}

export function currentOfflineRuntime(): OfflineCore | null {
  return provide?.() ?? null
}
