import type { Metadata } from 'next'
import { Card, Display, Section, SectionHeader, TextLink, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { DOCUMENTATION_PAGE } from '@/content/pages'
import { ROUTES } from '@/content/site'

export const metadata: Metadata = {
  title: DOCUMENTATION_PAGE.title,
  description:
    'Where to read about each Health ID module, and how implementation documentation reaches your team.',
}

/**
 * Documentation.
 *
 * This page exists because the navigation offers it, and it says honestly where
 * written material lives today: the product pages on this site, and the
 * material handed over during onboarding. It does not pretend to be a manual.
 */
export default function DocumentationPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="documentation-title">
          <Wrap>
            <SectionHeader
              eyebrow={DOCUMENTATION_PAGE.eyebrow}
              id="documentation-title"
              title={DOCUMENTATION_PAGE.title}
              lede={DOCUMENTATION_PAGE.lede}
              as="h1"
            />

            <ul className="mx-auto mt-12 grid max-w-[920px] gap-4 md:grid-cols-3">
              {DOCUMENTATION_PAGE.sections.map(entry => (
                <li key={entry.title} className="flex">
                  <Card className="flex flex-1 flex-col gap-2 p-6">
                    <Display as="h2" size="sm">
                      {entry.title}
                    </Display>
                    <p className="text-sm/relaxed text-muted">{entry.body}</p>
                  </Card>
                </li>
              ))}
            </ul>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
              <TextLink href={ROUTES.products}>
                Browse the products <span aria-hidden="true">&rarr;</span>
              </TextLink>
              <TextLink href={ROUTES.contact}>
                {DOCUMENTATION_PAGE.cta} <span aria-hidden="true">&rarr;</span>
              </TextLink>
            </div>
          </Wrap>
        </Section>
      </main>
      <SiteFooter cta />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
