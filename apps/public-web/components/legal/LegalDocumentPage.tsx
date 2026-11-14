import { Card, Section, SectionHeader, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { BackToTop } from '@/components/shared/BackToTop'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { ROUTES } from '@/content/site'
import { DATA_PROTECTION_OFFICER, type LegalDocument, type LegalNotice, type LegalSection } from '@/content/legal'

/**
 * One legal document, numbered section by section, with a link to its companion:
 * the Terms of Service and the Privacy Policy are one agreement, accepted together
 * at patient sign-up. A document with a notice (the Privacy Policy) shows it first.
 */
export function LegalDocumentPage({ document }: { document: LegalDocument }) {
  const companion = document.id === 'terms'
    ? { href: ROUTES.privacyPolicy, label: 'Read the Privacy Policy' }
    : { href: ROUTES.terms, label: 'Read the Terms of Service' }
  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy={`${document.id}-title`}>
          <Wrap>
            <SectionHeader eyebrow="Health ID" id={`${document.id}-title`} title={document.title} lede={document.lede} as="h1" />
            {document.notice && <Notice id={`${document.id}-notice`} notice={document.notice} />}
            <ol className="mx-auto mt-12 flex max-w-[760px] flex-col gap-8">
              {document.sections.map((section, index) => (
                <li key={section.title} aria-labelledby={`${document.id}-${index + 1}`}>
                  <h2 id={`${document.id}-${index + 1}`} className="text-[18px] font-semibold text-ink">{index + 1}. {section.title}</h2>
                  <SectionBody section={section} />
                </li>
              ))}
            </ol>
            <p className="mx-auto mt-12 max-w-[760px] text-[15px]">
              <a href={companion.href} className="font-semibold text-brand">{companion.label}</a>
            </p>
          </Wrap>
        </Section>
      </main>
      <SiteFooter />
      <BackToTop />
      <DemoDialog />
    </>
  )
}

/** A section's paragraphs and bullets, as the numbered sections show them. */
function SectionBody({ section }: { section: LegalSection }) {
  return (
    <>
      {section.paragraphs?.map(paragraph => <p key={paragraph} className="mt-3 text-[15px]/relaxed text-muted">{paragraph}</p>)}
      {section.bullets && section.bullets.length > 0 && (
        <ul className="mt-3 list-disc space-y-1.5 pl-6 text-[15px]/relaxed text-muted">
          {section.bullets.map(item => <li key={item}>{item}</li>)}
        </ul>
      )}
    </>
  )
}

/** The plain-language notice above the numbered sections, ending with the DPO's email and phone as links. */
function Notice({ id, notice }: { id: string; notice: LegalNotice }) {
  const dpo = DATA_PROTECTION_OFFICER
  const [first, ...rest] = notice.contact.paragraphs
  return (
    <section aria-labelledby={id} className="mx-auto mt-12 max-w-[760px]">
      <Card className="p-6 sm:p-8">
        <h2 id={id} className="text-[20px] font-semibold text-ink">{notice.title}</h2>
        {notice.paragraphs.map(paragraph => <p key={paragraph} className="mt-3 text-[15px]/relaxed text-muted">{paragraph}</p>)}
        {notice.sections.map((section, index) => (
          <div key={section.title} className="mt-6">
            <h3 id={`${id}-${index + 1}`} className="text-[16px] font-semibold text-ink">{section.title}</h3>
            <SectionBody section={section} />
          </div>
        ))}
        <div className="mt-6">
          <h3 id={`${id}-contact`} className="text-[16px] font-semibold text-ink">{notice.contact.title}</h3>
          {first && <p className="mt-3 text-[15px]/relaxed text-muted">{first}</p>}
          <ul className="mt-3 list-disc space-y-1.5 pl-6 text-[15px]/relaxed text-muted">
            <li>Email: <a href={`mailto:${dpo.email}`} className="font-semibold text-brand">{dpo.email}</a></li>
            <li>Phone: <a href={`tel:${dpo.phone}`} className="font-semibold text-brand">{dpo.phone}</a></li>
          </ul>
          {rest.map(paragraph => <p key={paragraph} className="mt-3 text-[15px]/relaxed text-muted">{paragraph}</p>)}
        </div>
      </Card>
    </section>
  )
}
