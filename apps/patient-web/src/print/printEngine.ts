/*
 * Which browsers print their own web address on the paper whatever the page asks (owner, 23 Nov 2026: no address,
 * title or date from the browser, in any browser, without anyone changing a print setting).
 *
 * - Chrome, Edge and every other Chromium browser draw their header and footer inside the page margin, and leave them
 *   off a page whose margin is 0 (print.css sets it). https://developer.chrome.com/blog/print-margins
 * - Firefox draws its header and footer only inside the page margin too, and keeps the 0 margin an @page rule asks for
 *   while its Margins setting is "Default", its default (layout/generic/nsPageFrame.cpp: ComputePageContentMargin and
 *   DrawHeaderFooter; toolkit/components/printing/content/print.js sets honorPageRuleMargins for "Default" alone).
 * - Safari on a Mac adds room for its header and footer outside the page's own margins and draws them whatever the page
 *   asks, unless what it prints is a PDF (WebKit: UIProcess/mac/WKPrintingView.mm and WebPageProxy::
 *   headerHeightForPrinting, which is 0 for a frame showing a PDF). Every browser on an iPhone or iPad is WebKit.
 *
 * So a WebKit browser is given the paper as a PDF (paperPdf.ts) to print from its own PDF viewer; the others print the
 * page itself.
 */

interface BrowserFacts {
  readonly userAgent: string
  readonly maxTouchPoints?: number
}

/** True where the browser prints its own header and footer (address, title, date) whatever the page asks: WebKit. */
export function printsAddressAnyway(browser: BrowserFacts | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!browser) return false
  const agent = browser.userAgent
  // Every browser on an iPhone or iPad is WebKit, whatever it is called (CriOS, FxiOS, EdgiOS). An iPad asks for the
  // desktop site by default, as a Mac that can be touched.
  if (/\b(iPhone|iPad|iPod)\b/.test(agent)) return true
  if (/\bMacintosh\b/.test(agent) && (browser.maxTouchPoints ?? 0) > 1 && !/\b(Chrome|Firefox)\//.test(agent)) return true
  // Gecko (Firefox and its kin) and Blink (Chrome, Edge, Opera, Samsung Internet and the rest).
  if (/\bGecko\/\d/.test(agent) && /\bFirefox\//.test(agent)) return false
  if (/\b(Chrome|Chromium|HeadlessChrome|Edg|OPR|SamsungBrowser)\//.test(agent)) return false
  // Safari on a Mac (and WebKit's other desktop browsers, which name themselves Safari too).
  return /\bAppleWebKit\//.test(agent) && /\bSafari\//.test(agent)
}
