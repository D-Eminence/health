import type { Metadata } from 'next'
import { Card, Display, Section, SectionHeader, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
import { CONTACT_PAGE } from '@/content/pages'
import { DEMO_INBOX } from '@/lib/demo-request'

export const metadata: Metadata = {
  title: CONTACT_PAGE.title,
  description: 'Book a Health ID demo, or email the team.',
}

/**
 * Contact.
 *
 * Two ways in and one warning: enquiries about a patient's own records belong
 * with the facility that created them, not with this website, and saying so here
 * is cheaper than saying it over email later.
 */
export default function ContactPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="contact-title">
          <Wrap>
            <SectionHeader
              eyebrow={CONTACT_PAGE.eyebrow}
              id="contact-title"
              title={CONTACT_PAGE.title}
              lede={CONTACT_PAGE.lede}
              as="h1"
            />

            <div className="mx-auto mt-12 grid max-w-[820px] gap-5 sm:grid-cols-2">
              <Card className="flex flex-col gap-3 p-7">
                <Display as="h2" size="sm">
                  {CONTACT_PAGE.demoTitle}
                </Display>
                <p className="text-[15px]/relaxed text-muted">
                  Tell us about your facility and we will arrange a walkthrough.
                </p>
                <HeroDemoButton className="mt-auto self-start">
                  {CONTACT_PAGE.demoTitle}
                </HeroDemoButton>
              </Card>

              <Card className="flex flex-col gap-3 p-7">
                <Display as="h2" size="sm">
                  {CONTACT_PAGE.emailLabel}
                </Display>
                <p className="text-[15px]/relaxed text-muted">
                  Prefer to write to us? Email the team directly.
                </p>
                <a
                  href={`mailto:${DEMO_INBOX}`}
                  className="mt-auto font-semibold text-brand hover:text-brand-dark"
                >
                  {DEMO_INBOX}
                </a>
              </Card>
            </div>

            <p className="mx-auto mt-8 max-w-[680px] text-center text-[13px]/relaxed text-faint">
              {CONTACT_PAGE.patientNote}
            </p>
          </Wrap>
        </Section>
      </main>
      <SiteFooter cta />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
