import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ButtonLink, Card, Display, Eyebrow, Lede, Section, SectionHeader, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { ProductDashboard } from '@/components/shared/ProductDashboard'
import { ProviderClosing } from '@/components/provider/Connected'
import { PRODUCTS } from '@/content/products'
import { PRODUCT_DETAILS, findProductDetail } from '@/content/product-details'
import { APP_ENTRY, ROUTES } from '@/content/site'

interface PageProps {
  readonly params: Promise<{ readonly slug: string }>
}

/** Every product page is known at build time, so all of them are pre-rendered. */
export function generateStaticParams() {
  return PRODUCT_DETAILS.map(product => ({ slug: product.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const product = findProductDetail(slug)
  if (!product) return {}

  return { title: product.name, description: product.sub }
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params
  const product = findProductDetail(slug)

  // An unknown slug is a 404, not an empty page. The catalogue is the contract
  // for what exists.
  if (!product) notFound()

  const others = PRODUCTS.filter(entry => entry.slug !== product.slug)

  return (
    <>
      <ProviderNav />
      <main id="main">
        {/* Hero, then the product's own dashboard. Showing the thing itself is
            the fastest way to explain what the module does. */}
        <Section labelledBy="product-title">
          <Wrap>
            <div className="mx-auto flex max-w-[760px] flex-col items-center gap-5 text-center">
              <Eyebrow tone="outline">{product.eyebrow}</Eyebrow>
              <Display as="h1" size="lg" id="product-title" className="text-center">
                {product.title}
              </Display>
              <Lede>{product.sub}</Lede>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
                <ButtonLink href="#demo">{product.cta}</ButtonLink>
                <ButtonLink href={ROUTES.providers} tone="secondary">
                  For healthcare providers
                </ButtonLink>
              </div>
            </div>

            <div className="mt-14">
              <ProductDashboard product={product} />
            </div>
          </Wrap>
        </Section>

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

        <Section id="workflows" labelledBy="workflows-title">
          <Wrap>
            <SectionHeader
              id="workflows-title"
              title="Designed for real healthcare operations."
              size="md"
            />
            <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {product.workflows.map(workflow => (
                <li key={workflow.title}>
                  <Card className="flex h-full flex-col gap-2.5 p-6">
                    <h3 className="text-[16px] font-semibold text-ink">{workflow.title}</h3>
                    <p className="text-[15px]/relaxed text-muted">{workflow.body}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </Wrap>
        </Section>

        <Section tone="inverse" labelledBy="integrations-title">
          <Wrap>
            <SectionHeader
              id="integrations-title"
              title="Connected to the ecosystem."
              tone="inverse"
              size="md"
            />
            <ul className="mt-12 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {product.integrations.map(integration => (
                <li
                  key={integration.name}
                  className="flex flex-col gap-1.5 rounded-(--radius-card) border border-white/12 bg-white/5 p-5"
                >
                  <h3 className="text-[15px] font-semibold text-white">{integration.name}</h3>
                  <p className="text-[14px]/relaxed text-inverse-muted">{integration.body}</p>
                </li>
              ))}
            </ul>
          </Wrap>
        </Section>

        <Section tone="sunk" labelledBy="other-products">
          <Wrap>
            <h2
              id="other-products"
              className="font-mono text-[11px] tracking-[0.12em] text-faint uppercase"
            >
              Other modules
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {others.map(other => (
                <li key={other.slug}>
                  <Link
                    href={ROUTES.product(other.slug)}
                    className="flex items-start gap-3 rounded-(--radius-card) border border-line bg-surface p-5 hover:border-brand"
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-tint font-mono text-[11px] font-semibold text-brand"
                    >
                      {other.mark}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[15px] font-semibold text-ink">{other.name}</span>
                      <span className="text-[13px]/relaxed text-muted">{other.summary}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Wrap>
        </Section>

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
