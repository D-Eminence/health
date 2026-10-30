/**
 * The shell's update channel (A9): Stream C's `offline/shellUpdate.ts`, which has no service worker API and so may be
 * imported statically. `setUnsavedFormsSource` returns its unplug. The shell itself (`enableShell`, `purgeShell`) is
 * reached only through `shellLoader.ts`.
 */
export { useShellUpdate, setUnsavedFormsSource, type ShellUpdate } from '../../offline/shellUpdate'
