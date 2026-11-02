/**
 * Opens a page on another Health ID site in place of this one, so that the back button does not return to the address
 * that sent it there. Its own module, so that tests can stand in for the browser's navigation.
 */
export function openSite(href: string): void {
  window.location.replace(href)
}
