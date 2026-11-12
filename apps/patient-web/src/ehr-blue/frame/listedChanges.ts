import { useCallback, useSyncExternalStore } from 'react'
import type { StaffSession } from '../../staff/api'
import type { EhrBluePage } from './types'

/**
 * What `listed` says now for each page that can say it changed (EhrBluePage.listedChanges), as one string ('10': the
 * first such page listed, the second not). The frame's sidebar and search are worked out again when it changes, so a
 * page whose `listed` reads something besides the session (an answer the page has learned from the backend) leaves the
 * sidebar, or comes back, with no new session. It changes only when an answer does: nothing else draws again. Nothing
 * is polled or kept: each page's own subscribe says when to ask.
 */
export function useListedChanges(pages: readonly EhrBluePage[], session: StaffSession | null): string {
  const subscribe = useCallback((onChange: () => void) => {
    const stops = pages.flatMap(page => page.listedChanges ? [page.listedChanges(onChange)] : [])
    return () => { for (const stop of stops) stop() }
  }, [pages])
  const snapshot = useCallback(() => pages.filter(page => page.listedChanges)
    .map(page => (session && (page.listed?.(session) ?? true) ? '1' : '0')).join(''), [pages, session])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
