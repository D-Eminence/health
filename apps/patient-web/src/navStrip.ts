import type { FocusEvent } from 'react'

/**
 * Below 900px the patient and provider navigation becomes a horizontal strip.
 * Chromium does not scroll a focused link that is partly showing, so tabbing
 * backwards can leave one as a sliver at the strip's edge. This shows all of
 * it; a link already in view does not move.
 */
export function revealFocusedLink(event: FocusEvent<HTMLElement>): void {
  const link = event.target
  if (link instanceof HTMLAnchorElement) link.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}
