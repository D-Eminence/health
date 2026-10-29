/**
 * The shell update channel, through one seam. Stream C builds `useShellUpdate()` in
 * `apps/patient-web/src/offline/shell.ts` in parallel; until it lands on offline/base this adapter answers "no
 * update", and the banner shows nothing. When it lands, this file re-exports it and nothing else changes.
 */
export interface ShellUpdate {
  /** A new build is installed and waiting. */
  readonly ready: boolean
  /** Another tab already moved to the new build. */
  readonly updatedElsewhere: boolean
  /** Whether a change is being sent in any tab (the update waits for it). */
  readonly sending: boolean
  /** Posts HID_SKIP_WAITING, waits for the new worker and reloads this tab. */
  update(): void
  reload(): void
}

const NONE: ShellUpdate = { ready: false, updatedElsewhere: false, sending: false, update: () => undefined, reload: () => undefined }

export function useShellUpdate(): ShellUpdate {
  return NONE
}

/**
 * Registers or updates the shell after a vault opens for an enabled facility (amendment A5). Stream C's `enableShell()`;
 * a no-op until it lands.
 */
export function enableShell(): void { /* Stream C's shell.ts (#36) */ }

/**
 * Deletes the shell caches when the facility has left the pilot and its vault opens send-only (§2.3 kill switch, T19,
 * A8.5). Stream C's `purgeShell()`; a no-op until it lands.
 */
export function purgeShell(): void { /* Stream C's shell.ts (#36) */ }

/** Tells the shell whether a form has unsaved changes, for its Update now gate (A7). A no-op until it lands. */
export function setUnsavedFormsSource(_source: () => boolean): void { /* Stream C's shell.ts (#36) */ }
