import { createLogger } from '@hid/observability'
import { paperTitle, type PaperSize } from './paperPages'
import { printsAddressAnyway } from './printEngine'

/*
 * Printing a paper with no web address on it, in every browser (owner, 23 Nov 2026), without anyone changing a print
 * setting. Chrome, Edge and Firefox print the page itself: its pages have no margin (print.css), so they print no
 * header or footer of their own. Safari, and every browser on an iPhone or iPad, prints its own header and footer
 * whatever a page asks, but never on a PDF (printEngine.ts): there the paper is made into a PDF on this device
 * (paperPdf.ts) and opened in a new tab, in the browser's own PDF viewer, to print from there.
 *
 * The new tab is opened at once, in the click (a browser opens a tab only then), and shows "Getting the paper ready"
 * until the PDF is made; its title is the paper's (the facility and what the paper is), never a patient's name or
 * Health ID, and its address is a blob: address of random letters, made and kept on this device and let go after a
 * few minutes. Where no tab may open, or the PDF cannot be made, the page prints itself after all, with real page
 * margins so every page keeps its margin there too.
 *
 * A PDF on screen stays there after its address is let go, so this page keeps hold of every tab it opened and closes
 * them all when someone signs out or the session ends (closePrintTabs, from staff/App.tsx), and when this page itself
 * goes: the next person at a shared computer never finds a patient's paper left open.
 */

export interface PaperPrint {
  /** The paper the PDF is made on (a page size, or a slip as long as the paper runs). */
  readonly size: PaperSize
  /** What the paper is, in a few words ("Discharge summary"), for its title. */
  readonly kind: string
}

export interface PrintJob {
  /** Prints `root`, the paper as it is on the page now; `done` once it no longer needs to be there. Returns an undo. */
  run(root: Element | null, done: () => void): () => void
}

const logger = createLogger({ minLevel: 'warn', baseContext: { app: 'patient-web', part: 'print' } })

/** How long the PDF's blob: address lasts once the tab has it. */
const PDF_ADDRESS_MS = 3 * 60 * 1000

/** The tabs this page opened for a paper's PDF, still open as far as it knows. */
const printTabs = new Set<Window>()

/** Closes every tab this page opened for a paper's PDF: at sign-out, when the session ends, and when this page goes. */
export function closePrintTabs(): void {
  for (const tab of printTabs) {
    try { if (!tab.closed) tab.close() } catch { /* already gone */ }
  }
  printTabs.clear()
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', closePrintTabs)

/** The margin a page keeps when the browser prints the page itself with page margins (a WebKit browser with no tab). */
const PAGE_MARGIN_MM: Readonly<Record<PaperSize, number>> = { A4: 14, A5: 10, A6: 8, slip: 5 }

/** The facility the paper's shared header names (EhrPrintHeader), if it has one. */
export function facilityOf(root: Element | null): string | null {
  return root?.querySelector('[data-print-header] .hid-ehr-print-header-facility')?.textContent?.trim() || null
}

/**
 * The page prints itself (window.print). The tab's title is the paper's while it prints (a browser offers it as the
 * name of a PDF saved from its dialog). `pageMargins` gives the pages real margins instead of none, and takes the
 * paper's own padding off: for a WebKit browser, whose header and footer no margin can keep off, so that every page,
 * not only the first, keeps its margin.
 */
function pagePrint(paper: PaperPrint, pageMargins: boolean): PrintJob {
  return {
    run(root, done) {
      const before = document.title
      const undo: Array<() => void> = []
      let over = false
      const restore = () => { while (undo.length) undo.pop()!() }
      const after = () => {
        if (over) return
        over = true
        restore()
        done()
      }
      document.title = paperTitle(facilityOf(root), paper.kind)
      undo.push(() => { document.title = before })
      // The paper asked for, of any on the page (a receipt and a new Health ID's slip can both be there): commerce.css
      // prints it alone.
      if (root) {
        root.setAttribute('data-print-chosen', '')
        undo.push(() => root.removeAttribute('data-print-chosen'))
      }
      if (pageMargins) {
        const margin = PAGE_MARGIN_MM[paper.size]
        const style = document.createElement('style')
        style.dataset.printMargins = ''
        style.textContent = ['', ' clinical-a5', ' clinical-a4', ' outreach-slip']
          .map(name => `@page${name} { margin: ${margin}mm !important; }`).join('\n')
        document.head.appendChild(style)
        undo.push(() => style.remove())
        for (const element of [document.body, root]) {
          if (!(element instanceof HTMLElement)) continue
          const style = element.getAttribute('style')
          element.style.setProperty('padding', '0', 'important')
          undo.push(() => { if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style) })
        }
      }
      window.addEventListener('afterprint', after, { once: true })
      try { window.print() } catch { after() }
      return () => {
        window.removeEventListener('afterprint', after)
        if (!over) restore()
      }
    },
  }
}

/** The new tab's page while the PDF is made: its title, and a line to say what is coming. */
function showWaiting(tab: Window, title: string) {
  try {
    const page = tab.document
    page.title = title
    const line = page.createElement('p')
    line.textContent = 'Getting the paper ready to print…'
    line.setAttribute('style', 'margin:48px auto;max-width:28rem;padding:0 16px;font:500 17px/1.5 system-ui,-apple-system,sans-serif;color:#1570ef;text-align:center')
    page.body.replaceChildren(line)
  } catch {
    // A tab this page may not write to still gets the PDF.
  }
}

/** The PDF in the tab, in the browser's PDF viewer; its address is let go after a few minutes. */
function showPdf(tab: Window, pdf: Blob) {
  const address = URL.createObjectURL(pdf)
  tab.location.replace(address)
  setTimeout(() => URL.revokeObjectURL(address), PDF_ADDRESS_MS)
}

/** The paper as a PDF in `tab`; the page prints itself instead if the PDF cannot be made. */
function pdfPrint(paper: PaperPrint, tab: Window): PrintJob {
  let started = false
  return {
    run(root, done) {
      // Run once: a second run (React's development double effect) would make the PDF twice.
      if (started) return () => {}
      started = true
      if (!root) {
        printTabs.delete(tab)
        tab.close()
        done()
        return () => {}
      }
      const title = paperTitle(facilityOf(root), paper.kind)
      showWaiting(tab, title)
      void import('./paperPdf')
        .then(({ paperPdf }) => paperPdf(root, { size: paper.size, title }))
        .then(pdf => {
          if (!tab.closed) showPdf(tab, pdf)
          done()
        })
        .catch((error: unknown) => {
          logger.warn('A paper could not be made into a PDF; the page prints itself.', { reason: error instanceof Error ? error.name : 'unknown' })
          printTabs.delete(tab)
          if (!tab.closed) tab.close()
          pagePrint(paper, true).run(root, done)
        })
      return () => {}
    },
  }
}

/**
 * Starts printing a paper. Call it in the click that asks to print (a WebKit browser opens the PDF's tab only then),
 * then `run` the job with the paper once it is on the page.
 */
export function startPrint(paper: PaperPrint): PrintJob {
  if (!printsAddressAnyway()) return pagePrint(paper, false)
  let tab: Window | null = null
  try { tab = window.open('', '_blank') } catch { tab = null }
  if (!tab) return pagePrint(paper, true)
  printTabs.add(tab)
  try { tab.opener = null } catch { /* the tab keeps no hold on this page either way */ }
  return pdfPrint(paper, tab)
}

/** Prints a paper that is on the page already (a receipt), from the click that asks for it. */
export function printPaper(root: Element | null, paper: PaperPrint): void {
  startPrint(paper).run(root, () => {})
}

/** Which slip a point-of-care Print button prints: a bill's receipt, or the slip for a Health ID just made. */
export type ReceiptKind = 'receipt' | 'health-id'

const RECEIPT_SELECTOR: Readonly<Record<ReceiptKind, string>> = {
  receipt: "[data-receipt-print]:not([data-receipt-print='health-id'])",
  'health-id': "[data-receipt-print='health-id']",
}

/** The slip a Print button prints: the last one of its kind in the nearest part of the page that holds one. */
export function receiptFor(from: Element | null, kind: ReceiptKind = 'receipt'): Element | null {
  for (let node = from; node; node = node.parentElement) {
    const found = node.querySelectorAll(RECEIPT_SELECTOR[kind])
    if (found.length) return found[found.length - 1]!
  }
  return null
}

/** Prints the receipt (or a new Health ID's slip) nearest the Print button pressed, and only that. */
export function printReceipt(button: Element | null, kind: ReceiptKind = 'receipt'): void {
  printPaper(receiptFor(button, kind), { size: 'slip', kind: kind === 'health-id' ? 'Health ID slip' : 'Receipt' })
}
