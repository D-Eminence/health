/**
 * Leaves this page for `href` (single sign-on's start, or the provider's end-session address) in place of its history
 * entry, as openSite.ts does for another site: the back button then returns to the page before, never to a page that
 * would hand off again. Its own module, so that tests can stand in for the browser's navigation.
 */
export function leavePage(href: string): void {
  window.location.replace(href)
}
