import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * Printing a paper with no web address in any browser (printPaper.ts): Chrome, Edge and Firefox print the page; Safari
 * and every browser on an iPhone or iPad get the paper as a PDF in a new tab. Fictional data only.
 */

const paperPdf = vi.fn<(root: Element, options: { size: string; title: string }) => Promise<Blob>>()
vi.mock('../../print/paperPdf', () => ({ paperPdf: (root: Element, options: { size: string; title: string }) => paperPdf(root, options) }))

const { printReceipt, receiptFor, startPrint } = await import('../../print/printPaper')

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15'

function browser(agent: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent)
}

/** A paper as the page holds it while it prints: the shared header with the facility, and the patient. */
function paper(attributes: Record<string, string> = { 'data-clinical-print': 'discharge' }) {
  const root = document.createElement('div')
  for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value)
  root.innerHTML = '<div data-print-header=""><p class="hid-ehr-print-header-facility">Demo Hospital</p></div><p>Patient One</p><p>HID-ZDEMAAA2</p>'
  document.body.appendChild(root)
  return root
}

/** A tab as window.open gives it: its own page, and an address the PDF is put at. */
function fakeTab() {
  const page = document.implementation.createHTMLDocument('')
  return { document: page, location: { replace: vi.fn() }, close: vi.fn(), closed: false, opener: {} as unknown }
}

afterEach(() => {
  window.dispatchEvent(new Event('afterprint'))
  document.body.replaceChildren()
  document.head.querySelectorAll('style[data-print-margins]').forEach(style => style.remove())
  document.title = ''
  paperPdf.mockReset()
})

describe('Chrome, Edge and Firefox: the page prints itself', () => {
  it('with the paper’s title (the facility and what it is) while it prints, and the paper alone chosen', () => {
    browser(CHROME)
    document.title = 'Patient One · Health ID EHR'
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.title).toBe('Demo Hospital · Discharge summary')
      expect(root.hasAttribute('data-print-chosen')).toBe(true)
    })
    const open = vi.spyOn(window, 'open')
    const root = paper()
    const done = vi.fn()
    startPrint({ size: 'A4', kind: 'Discharge summary' }).run(root, done)
    expect(print).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
    expect(done).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('afterprint'))
    expect(done).toHaveBeenCalledOnce()
    expect(document.title).toBe('Patient One · Health ID EHR')
    expect(root.hasAttribute('data-print-chosen')).toBe(false)
    // No page margins of its own: print.css keeps every page's margin at 0, so no header or footer prints.
    expect(document.querySelector('style[data-print-margins]')).toBeNull()
  })

  it('puts no Health ID or patient name in the title', () => {
    browser(CHROME)
    let title = ''
    vi.spyOn(window, 'print').mockImplementation(() => { title = document.title })
    startPrint({ size: 'A5', kind: 'Prescription' }).run(paper(), () => {})
    expect(title).toBe('Demo Hospital · Prescription')
    expect(title).not.toMatch(/HID-|Patient One/)
  })
})

describe('Safari and every browser on an iPhone or iPad: a PDF in a new tab', () => {
  it('opens the tab in the click, shows the paper’s title there, and puts the PDF at a blob: address made here', async () => {
    browser(SAFARI)
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const blob = new Blob(['%PDF-1.3'], { type: 'application/pdf' })
    paperPdf.mockResolvedValue(blob)
    const created = vi.fn(() => 'blob:https://ehr.example.test/0b7c4c4e-2f4e-4f0f-9d5b-1a2b3c4d5e6f')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }))
    const job = startPrint({ size: 'A4', kind: 'Discharge summary' })
    expect(window.open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    const root = paper()
    const done = vi.fn()
    job.run(root, done)
    expect(tab.document.title).toBe('Demo Hospital · Discharge summary')
    expect(tab.document.body.textContent).toBe('Getting the paper ready to print…')
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce())
    expect(paperPdf).toHaveBeenCalledWith(root, { size: 'A4', title: 'Demo Hospital · Discharge summary' })
    expect(created).toHaveBeenCalledWith(blob)
    expect(tab.location.replace).toHaveBeenCalledWith('blob:https://ehr.example.test/0b7c4c4e-2f4e-4f0f-9d5b-1a2b3c4d5e6f')
    expect(print).not.toHaveBeenCalled()
    // A second run (React's development double effect) makes no second PDF.
    job.run(root, done)
    expect(paperPdf).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('prints the page itself, with real page margins, when no tab may open', () => {
    browser(SAFARI)
    vi.spyOn(window, 'open').mockReturnValue(null)
    const root = paper()
    root.style.setProperty('padding', '3mm')
    vi.spyOn(window, 'print').mockImplementation(() => {
      const margins = document.querySelector('style[data-print-margins]')?.textContent ?? ''
      expect(margins).toContain('@page { margin: 14mm !important; }')
      expect(margins).toContain('@page clinical-a4 { margin: 14mm !important; }')
      expect(root.style.getPropertyValue('padding')).toBe('0px')
      expect(root.style.getPropertyPriority('padding')).toBe('important')
    })
    startPrint({ size: 'A4', kind: 'Discharge summary' }).run(root, () => {})
    expect(window.print).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('afterprint'))
    expect(document.querySelector('style[data-print-margins]')).toBeNull()
    expect(root.style.getPropertyValue('padding')).toBe('3mm')
  })

  it('closes the tab and prints the page itself when the PDF cannot be made', async () => {
    browser(SAFARI)
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    paperPdf.mockRejectedValue(new Error('no canvas'))
    startPrint({ size: 'A6', kind: 'Registration slip' }).run(paper(), () => {})
    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce())
    expect(tab.close).toHaveBeenCalled()
    expect(tab.location.replace).not.toHaveBeenCalled()
  })
})

describe('point-of-care slips', () => {
  it('prints the receipt for a receipt’s Print, and the Health ID slip for its own Print, never both', () => {
    document.body.innerHTML = `<main>
      <section data-receipt-print="" id="receipt"></section>
      <div id="panel"><button id="slip-print">Print slip</button><section data-receipt-print="health-id" id="slip"></section></div>
      <div id="actions"><button id="receipt-print">Print receipt</button></div>
    </main>`
    expect(receiptFor(document.getElementById('receipt-print'))?.id).toBe('receipt')
    expect(receiptFor(document.getElementById('slip-print'), 'health-id')?.id).toBe('slip')
    browser(CHROME)
    const chosen: string[] = []
    vi.spyOn(window, 'print').mockImplementation(() => {
      chosen.push(...[...document.querySelectorAll('[data-print-chosen]')].map(element => element.id))
    })
    printReceipt(document.getElementById('receipt-print'))
    window.dispatchEvent(new Event('afterprint'))
    printReceipt(document.getElementById('slip-print'), 'health-id')
    window.dispatchEvent(new Event('afterprint'))
    expect(chosen).toEqual(['receipt', 'slip'])
    expect(document.querySelectorAll('[data-print-chosen]')).toHaveLength(0)
  })
})
