import type { Metadata } from 'next'
import { Card, Section, SectionHeader, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { PRIVACY_PAGE } from '@/content/pages'
import { DEMO_INBOX } from '@/lib/demo-request'

export const metadata: Metadata = {
  title: PRIVACY_PAGE.title,
  description:
    'What this website does and does not collect. This notice covers the public site only, not patient records held in the platform.',
}

/**
 * Privacy.
 *
 * Scoped deliberately to this website. Every statement here is one the code
 * supports: the public site sets no cookies, stores nothing in the browser, runs
 * no analytics and sends nothing anywhere — the demo form hands the enquiry to
 * the visitor's own mail client. Nothing is claimed about the platform's own
 * handling of clinical data beyond pointing the reader at where that notice
 * comes from.
 */
export default function PrivacyPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="privacy-title">
          <Wrap>
            <SectionHeader
              eyebrow={PRIVACY_PAGE.eyebrow}
              id="privacy-title"
              title={PRIVACY_PAGE.title}
              lede={PRIVACY_PAGE.lede}
              as="h1"
            />

            <ul className="mx-auto mt-12 flex max-w-[760px] flex-col gap-4">
              {PRIVACY_PAGE.points.map(point => (
                <li key={point.title}>
                  <Card className="flex flex-col gap-2 p-6">
                    <h2 className="text-[16px] font-semibold text-ink">{point.title}</h2>
                    <p className="text-[15px]/relaxed text-muted">{point.body}</p>
                  </Card>
                </li>
              ))}
            </ul>

            <p className="mx-auto mt-8 max-w-[680px] text-center text-[15px] text-muted">
              {PRIVACY_PAGE.contactNote}{' '}
              <a href={`mailto:${DEMO_INBOX}`} className="font-semibold text-brand">
                {DEMO_INBOX}
              </a>
              .
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
