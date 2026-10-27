import { Section, SectionHeader, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { BackToTop } from '@/components/shared/BackToTop'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { ROUTES } from '@/content/site'
import type { LegalDocument } from '@/content/legal'

/**
 * One legal document, numbered section by section, with a link to its companion:
 * the Terms of Service and the Privacy Policy are one agreement, accepted together
 * at patient sign-up.
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
            <ol className="mx-auto mt-12 flex max-w-[760px] flex-col gap-8">
              {document.sections.map((section, index) => (
                <li key={section.title} aria-labelledby={`${document.id}-${index + 1}`}>
                  <h2 id={`${document.id}-${index + 1}`} className="text-[18px] font-semibold text-ink">{index + 1}. {section.title}</h2>
                  {section.paragraphs?.map(paragraph => <p key={paragraph} className="mt-3 text-[15px]/relaxed text-muted">{paragraph}</p>)}
                  {section.bullets && section.bullets.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1.5 pl-6 text-[15px]/relaxed text-muted">
                      {section.bullets.map(item => <li key={item}>{item}</li>)}
                    </ul>
                  )}
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
