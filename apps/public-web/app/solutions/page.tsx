import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Reveal } from '@/components/motion/Reveal'
import { Card, Display, Lede, Section, SectionHeader, TextLink, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { SOLUTIONS_PAGE } from '@/content/pages'
import { findProduct } from '@/content/products'
import { ROUTES, SOLUTION_IMAGES, type SolutionAudienceId } from '@/content/site'

export const metadata: Metadata = {
  title: SOLUTIONS_PAGE.title,
  description:
    'How hospitals, clinics, diagnostic centres, pharmacies and public health programmes use Health ID.',
}

/**
 * Solutions.
 *
 * The five settings the navigation offers, each with the workflows that differ
 * between them. Every claim here is drawn from the product catalogue rather than
 * written fresh, and each setting links back to the products that carry it.
 */
export default function SolutionsPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="solutions-title">
          <Wrap>
            <SectionHeader
              eyebrow={SOLUTIONS_PAGE.eyebrow}
              id="solutions-title"
              title={SOLUTIONS_PAGE.title}
              lede={SOLUTIONS_PAGE.lede}
              as="h1"
            />
          </Wrap>
        </Section>

        {SOLUTIONS_PAGE.audiences.map((audience, index) => (
          <Section
            key={audience.id}
            id={audience.id}
            tone={index % 2 === 0 ? 'plain' : 'sunk'}
            labelledBy={`${audience.id}-title`}
          >
            <Wrap>
              <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
                <div className="flex flex-col gap-4">
                  <Display as="h2" size="md" id={`${audience.id}-title`}>
                    {audience.title}
                  </Display>
                  <Lede align="left">{audience.lede}</Lede>
                  <Reveal className="solution-audience-image">
                    <Image
                      src={SOLUTION_IMAGES[audience.id as SolutionAudienceId].src}
                      alt={SOLUTION_IMAGES[audience.id as SolutionAudienceId].alt}
                      fill sizes="(min-width: 1024px) 45vw, 100vw"
                      className="object-cover"
                      style={{ objectPosition: SOLUTION_IMAGES[audience.id as SolutionAudienceId].position }}
                    />
                  </Reveal>
                </div>

                <div className="flex flex-col justify-center gap-5">
                  <ul className="flex flex-col gap-3">
                    {audience.points.map(point => (
                      <li key={point} className="flex items-start gap-3 text-[15px]/relaxed text-ink">
                        <svg
                          viewBox="0 0 16 16"
                          aria-hidden="true"
                          className="mt-1.5 h-3.5 w-3.5 shrink-0 text-brand"
                        >
                          <path
                            d="M3 8.5l3 3 7-7"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {point}
                      </li>
                    ))}
                  </ul>

                  <p className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5 text-sm">
                    <span className="font-mono text-[11px] tracking-[0.12em] text-faint uppercase">
                      Products
                    </span>
                    {audience.products.map(slug => {
                      const product = findProduct(slug)
                      if (!product) return null

                      return (
                        <Link
                          key={slug}
                          href={ROUTES.product(slug)}
                          className="font-medium text-brand hover:text-brand-dark"
                        >
                          {product.name}
                        </Link>
                      )
                    })}
                  </p>
                </div>
              </div>
            </Wrap>
          </Section>
        ))}

        <Section rhythm="tight" tone="sunk">
          <Wrap>
            <Card className="mx-auto flex max-w-[720px] flex-col items-center gap-4 p-8 text-center">
              <Display as="h2" size="sm">
                Not sure which module you need?
              </Display>
              <p className="text-[15px]/relaxed text-muted">
                Tell us what you run today and we will start from there.
              </p>
              <TextLink href={ROUTES.products}>
                See every product <span aria-hidden="true">&rarr;</span>
              </TextLink>
            </Card>
          </Wrap>
        </Section>
      </main>
      <SiteFooter cta />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
