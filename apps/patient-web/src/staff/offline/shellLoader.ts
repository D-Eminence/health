/**
 * The shell (`enableShell`, `purgeShell`), reached only through a dynamic import: a static import would put service
 * worker registration in the EHR chunk, which the launch build check refuses. Stream C's
 * `apps/patient-web/src/offline/shell.ts` (#36); until it lands this answers no-ops, and then the body becomes
 * `return import('../../offline/shell')`.
 */
export interface Shell {
  /** Registers or updates the shell after a vault opens for an enabled facility (A5). */
  enableShell(): void
  /** Deletes the shell caches when the facility has left the pilot (§2.3 kill switch, A8.5). */
  purgeShell(): void
}

const NONE: Shell = { enableShell: () => undefined, purgeShell: () => undefined }

export function loadShell(): Promise<Shell> {
  return Promise.resolve(NONE)
}
