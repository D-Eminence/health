/**
 * Whether keyboard focus fell to a wrapper around `target` rather than to a place the person chose (PPS-04). A second
 * quick tap or click on a button that the first one disabled lands on the disabled button, and Chromium then focuses
 * its nearest focusable ancestor: the portal's outlet, or a part of the profile that a link gave tabindex -1. That is
 * no more a place to stay than the page itself, so focus after the action still moves on. A heading with tabindex -1
 * is not such a wrapper: focus is put there on purpose.
 */
export function focusOnWrapper(target: Element): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== target && active.getAttribute('tabindex') === '-1'
    && !/^H[1-6]$/.test(active.tagName) && active.contains(target)
}
