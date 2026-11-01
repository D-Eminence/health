import './agreements.css'
import { agreementDate, versionLine, type AgreementDocument } from './types'

/** Who signed or agreed, and when, printed under the version line of a copy. */
export interface AgreementSigned {
  readonly by?: string | null
  readonly on?: string | null
}

const PRINT_CLASS = 'hid-agreement-print'

/**
 * "Download copy": the agreement alone, printed (the browser offers Save as PDF). A copy of the text is placed at the
 * end of the page for the print only (agreements.css hides everything else), then removed once printing is done. The
 * page and any form on it are left as they were. Text only: nothing is read as HTML.
 */
export function printAgreement(document: AgreementDocument, signed?: AgreementSigned) {
  const doc = window.document
  doc.querySelectorAll(`body > .${PRINT_CLASS}`).forEach(node => node.remove())
  const root = doc.createElement('div')
  root.className = PRINT_CLASS
  root.setAttribute('aria-hidden', 'true')
  const add = (parent: HTMLElement, tag: string, text?: string, className?: string) => {
    const element = doc.createElement(tag)
    if (text !== undefined) element.textContent = text
    if (className) element.className = className
    parent.append(element)
    return element
  }
  add(root, 'h1', document.title)
  add(root, 'p', versionLine(document), 'hid-agreement-print-meta')
  const who = signed?.by?.trim()
  const when = signed?.on ? agreementDate(signed.on.slice(0, 10)) : ''
  if (who || when) add(root, 'p', [who && `Agreed by ${who}`, when && `on ${when}`].filter(Boolean).join(' '), 'hid-agreement-print-meta')
  for (const section of document.sections) {
    const part = add(root, 'section')
    add(part, 'h2', section.heading)
    if (section.bullets?.length) {
      const list = add(part, 'ul')
      for (const bullet of section.bullets) add(list, 'li', bullet)
    }
    for (const paragraph of section.paragraphs ?? []) add(part, 'p', paragraph)
  }
  doc.body.append(root)
  const done = () => { window.removeEventListener('afterprint', done); root.remove() }
  window.addEventListener('afterprint', done)
  try { window.print() } catch { done() }
}
