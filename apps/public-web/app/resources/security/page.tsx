import type { Metadata } from 'next'
import { Card, Display, Lede, Section, SectionHeader, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { SECURITY_PAGE } from '@/content/pages'
import { ACCESS_SECTION, STANDARDS } from '@/content/provider'

export const metadata: Metadata = {
  title: SECURITY_PAGE.title,
  description:
    'How access to patient information is controlled on Health ID, and what this website itself does with data.',
}

/**
 * Security.
 *
 * Moved here from the homepage, where it was competing with the product story.
 * It describes supported access controls and the public site's commercial
 * gateway calls without claiming an external certification.
 */
export default function SecurityPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="security-title">
          <Wrap>
            <SectionHeader
              eyebrow={SECURITY_PAGE.eyebrow}
              id="security-title"
              title={SECURITY_PAGE.title}
              lede={SECURITY_PAGE.lede}
              as="h1"
            />

            <Card className="mx-auto mt-10 max-w-[680px] p-6">
              <p className="text-[15px]/relaxed text-muted">{SECURITY_PAGE.websiteNote}</p>
            </Card>

            <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {ACCESS_SECTION.controls.map(control => (
                <li key={control.title}>
                  <Card className="flex h-full flex-col gap-2 p-6">
                    <h2 className="text-[15px] font-semibold text-ink">{control.title}</h2>
                    <p className="text-sm/relaxed text-muted">{control.body}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </Wrap>
        </Section>

        <Section tone="sunk" labelledBy="standards-title">
          <Wrap>
            <SectionHeader
              eyebrow={STANDARDS.eyebrow}
              id="standards-title"
              title={STANDARDS.title}
              size="md"
            />

            <ul className="mt-12 grid gap-4 sm:grid-cols-2">
              {STANDARDS.items.map(standard => (
                <li key={standard.name}>
                  <Card className="flex h-full flex-col gap-2 p-6">
                    <Display as="h2" size="sm" className="font-mono text-[15px] text-brand">
                      {standard.name}
                    </Display>
                    <p className="text-[15px] font-semibold text-ink">{standard.summary}</p>
                    <p className="text-sm/relaxed text-muted">{standard.body}</p>
                  </Card>
                </li>
              ))}
            </ul>

            <Lede align="center" className="mt-8 max-w-[62ch] text-[13px]">
              {STANDARDS.disclaimer}
            </Lede>
          </Wrap>
        </Section>
      </main>
      <SiteFooter cta />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
