/**
 * The shell's update channel, through one seam. Stream C's `apps/patient-web/src/offline/shellUpdate.ts` (#36) holds
 * `useShellUpdate()` and `setUnsavedFormsSource`, with no service worker API, so it may be imported statically. Until
 * it lands on offline/base this adapter answers "no update" and the banner shows nothing; then this file re-exports
 * it. The shell itself (`enableShell`, `purgeShell`) is reached only through `shellLoader.ts`.
 */
export interface ShellUpdate {
  /** A new build is installed and waiting. */
  readonly ready: boolean
  /** Another tab already moved to the new build. */
  readonly updatedElsewhere: boolean
  /** Whether a change is being sent in any tab (the update waits for it). */
  readonly sending: boolean
  /**
   * Whether "Update now" may be pressed: ready, no form with unsaved changes (setUnsavedFormsSource) and nothing
   * sending in any tab (A7, A9).
   */
  readonly canUpdate: boolean
  /** Posts HID_SKIP_WAITING, waits for the new worker and reloads this tab. */
  update(): void
  reload(): void
}

const NONE: ShellUpdate = { ready: false, canUpdate: false, updatedElsewhere: false, sending: false, update: () => undefined, reload: () => undefined }

export function useShellUpdate(): ShellUpdate {
  return NONE
}

/**
 * Tells the shell whether a form has unsaved changes, for its Update now gate (A7, A9). A no-op until it lands. Returns
 * a cleanup when the shell gives one.
 */
export function setUnsavedFormsSource(_source: () => boolean): (() => void) | void { /* Stream C's offline/shellUpdate.ts (#36) */ }
