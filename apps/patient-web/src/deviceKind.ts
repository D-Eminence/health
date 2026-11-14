/**
 * What kind of device and window the portal runs in, for the two device sections on the Notifications page (contract
 * b6-contract.md §11.3-11.5). No push or install API is touched here: pushDevice.ts holds those.
 */

/** An iPhone, iPad or iPod. iPadOS 13 and later says Macintosh, and is told apart by its touch screen. */
export function isAppleMobile(nav: Navigator = navigator): boolean {
  const agent = nav.userAgent ?? ''
  return /iPad|iPhone|iPod/.test(agent) || (/Macintosh/.test(agent) && (nav.maxTouchPoints ?? 0) > 1)
}

/**
 * Safari, or another real iPhone/iPad browser (Chrome, Firefox and Edge there all carry "Safari/" and can Add to
 * Home Screen on iOS 16.4 and later), not an app's built-in web view (Facebook, Instagram, a messaging app), which
 * has no Share > Add to Home Screen. The Home Screen app has no "Safari/" either; runningInstalled() tells it apart.
 */
export function isAppleBrowserTab(nav: Navigator = navigator): boolean {
  return isAppleMobile(nav) && /\bSafari\//.test(nav.userAgent ?? '')
}

/** Whether this window is the installed app (opened from the home screen or the app list), not a browser tab. */
export function runningInstalled(win: Window = window): boolean {
  let standalone = false
  try { standalone = typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches } catch { /* no media queries */ }
  // Safari on iPhone and iPad says so on navigator, and answers no media query for it before iOS 15.
  return standalone || (win.navigator as Navigator & { standalone?: boolean }).standalone === true
}
