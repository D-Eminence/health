import { Download } from 'lucide-react'
import { Drawer } from '../kasuwa/interactive'
import { Button } from '../kasuwa/ui'
import { printAgreement, type AgreementSigned } from './printAgreement'
import { versionLine, type AgreementDocument } from './types'

/** An agreement's full text: its sections, numbered as written. */
export function AgreementText({ document }: { readonly document: AgreementDocument }) {
  // Focusable, so the text can be scrolled with the keyboard in the sheet's scrolling body.
  return <div tabIndex={0} role="region" aria-label={`${document.title}, full text`}
    className="flex flex-col gap-5 rounded-md text-sm leading-relaxed text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus-ring-color)]">
    {document.sections.map(section => <section key={section.heading} className="flex flex-col gap-2">
      <h3 className="m-0 text-[15px] font-semibold text-ink">{section.heading}</h3>
      {section.bullets?.length ? <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-ink-2 marker:text-ink-3">
        {section.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}
      </ul> : null}
      {section.paragraphs?.map(paragraph => <p key={paragraph} className="m-0 text-ink-2">{paragraph}</p>)}
    </section>)}
  </div>
}

/**
 * The full agreement in a sheet over the page (never a new tab, so a form being filled in keeps what was typed): its
 * title, version and date, the sections, "Download copy" (printAgreement: the browser's print, which can save a PDF)
 * and Close. Focus moves into the sheet as it opens and back to the link that opened it as it closes (Drawer).
 */
export function AgreementSheet({ document, open, onClose, signed }: {
  readonly document: AgreementDocument
  readonly open: boolean
  readonly onClose: () => void
  /** Who agreed, and when, for the printed copy (the profile's Agreements and the facility's Agreement card). */
  readonly signed?: AgreementSigned
}) {
  return <Drawer open={open} onClose={onClose} title={document.title} description={versionLine(document)}
    footer={<>
      <Button size="lg" icon={Download} onClick={() => printAgreement(document, signed)}>Download copy</Button>
      <Button size="lg" variant="primary" onClick={onClose}>Close</Button>
    </>}>
    <AgreementText document={document} />
  </Drawer>
}
