/**
 * The shell (`enableShell`, `purgeShell`), reached only through a dynamic import (A9): a static import would put
 * service worker registration in the EHR chunk, which the launch build check refuses.
 */
export function loadShell() {
  return import('../../offline/shell')
}
