import type { FocusEvent } from 'react'

/**
 * Below 900px the patient and provider navigation becomes a horizontal strip.
 * Chromium does not scroll a focused link that is partly showing, so tabbing
 * backwards can leave one as a sliver at the strip's edge. For keyboard focus
 * this scrolls the strip, and only the strip, by the part of the link that is
 * cut off. The page never moves: scrolling it from a focus event lost clicks
 * near the top of the screen and jumped the page back when the tab or window was
 * focused again. Pointer focus moves nothing: moving the strip under a press
 * takes the link out from under it and the click is lost.
 */
export function revealFocusedLink(event: FocusEvent<HTMLElement>): void {
  const strip = event.currentTarget
  const link = event.target
  if (!(link instanceof HTMLAnchorElement) || !link.matches(':focus-visible') || strip.scrollWidth <= strip.clientWidth) return
  const shown = strip.getBoundingClientRect()
  const box = link.getBoundingClientRect()
  if (box.left < shown.left) strip.scrollLeft -= shown.left - box.left
  else if (box.right > shown.right) strip.scrollLeft += box.right - shown.right
}
