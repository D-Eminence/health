import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { Display, Section, SectionHeader, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { ProductHero } from '@/components/provider/ProductHero'
import { ProviderClosing } from '@/components/provider/Closing'
import { ApiCodeVisual } from '@/components/product/ApiCodeVisual'
import { WorkflowBento } from '@/components/product/WorkflowBento'
import { EhrWorkflowBento } from '@/components/product/EhrWorkflowBento'
import { HealthIDModuleShowcase } from '@/components/product/HealthIDModuleShowcase'
import { PRODUCT_DETAILS, findProductDetail } from '@/content/product-details'
import { APP_ENTRY, ROUTES } from '@/content/site'
import type { HealthIDModuleSlug } from '@/content/module-showcase'

interface PageProps {
  readonly params: Promise<{ readonly slug: string }>
}

/** Every product page is known at build time, so all of them are pre-rendered. */
export function generateStaticParams() {
  return PRODUCT_DETAILS.filter(product => product.slug !== 'identity').map(product => ({ slug: product.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const product = findProductDetail(slug)
  if (!product) return {}

  return { title: product.name, description: product.sub }
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params

  if (slug === 'identity') redirect(ROUTES.patients)

  const product = findProductDetail(slug)

  // An unknown slug is a 404, not an empty page. The catalogue is the contract
  // for what exists.
  if (!product) notFound()

  return (
    <>
      <ProviderNav />
      <main id="main">
        <ProductHero product={product} />

        <Section tone="sunk" labelledBy="narrative-title">
          <Wrap>
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
              <Display as="h2" size="md" id="narrative-title">
                {product.narrativeTitle}
              </Display>
              <div className="flex flex-col gap-4">
                {product.narrativeBody.map(paragraph => (
                  <p key={paragraph} className="text-base/relaxed text-muted">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </Wrap>
        </Section>

        {product.slug === 'api' ? (
          <Section labelledBy="api-example-title">
            <Wrap>
              <SectionHeader id="api-example-title" title="An authorised request, from start to finish." size="md" />
              <div className="mt-10"><ApiCodeVisual /></div>
            </Wrap>
          </Section>
        ) : null}

        {product.slug === 'ehr' ? (
          <EhrWorkflowBento />
        ) : (
          <WorkflowBento product={product} />
        )}

        <HealthIDModuleShowcase
          currentModule={product.slug as HealthIDModuleSlug}
          defaultActive={product.slug === 'ehr' ? 'laboratory' : 'ehr'}
        />

        <ProviderClosing
          title={product.closingTitle}
          lede={product.closingBody}
          primary={product.cta}
          secondary="Hospital sign in"
          secondaryHref={APP_ENTRY.staffSignIn}
        />
      </main>
      <SiteFooter />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
