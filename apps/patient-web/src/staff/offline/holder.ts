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

/**
 * Forgets the key a sign-in derived when Identity refused the password (D2): it must never key a session another tab
 * readies later. Calls the runtime's `forgetSignIn()` (#39); a runtime without it has nothing to forget yet.
 */
export function forgetRefusedSignIn(): void {
  const runtime = currentOfflineRuntime() as (OfflineCore & { forgetSignIn?: () => void }) | null
  runtime?.forgetSignIn?.()
}
