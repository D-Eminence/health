import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ButtonLink, Card, Display, Eyebrow, Section, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { ProviderClosing } from '@/components/provider/Connected'
import { PRODUCTS, findProduct } from '@/content/products'
import { APP_ENTRY, ROUTES } from '@/content/site'

interface PageProps {
  readonly params: Promise<{ readonly slug: string }>
}

/** Every product page is known at build time, so all of them are pre-rendered. */
export function generateStaticParams() {
  return PRODUCTS.map(product => ({ slug: product.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const product = findProduct(slug)
  if (!product) return {}

  return { title: product.name, description: product.summary }
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params
  const product = findProduct(slug)

  // An unknown slug is a 404, not an empty page. The catalogue is the contract
  // for what exists.
  if (!product) notFound()

  const others = PRODUCTS.filter(entry => entry.slug !== product.slug)

  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="product-title">
          <Wrap>
            <div className="flex max-w-[760px] flex-col items-start gap-5">
              <Eyebrow tone="outline">{product.name}</Eyebrow>
              <Display as="h1" size="lg" id="product-title">
                {product.headline}
              </Display>
              <p className="text-base/relaxed text-muted">{product.intro}</p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <ButtonLink href="#demo">Book an EHR demo</ButtonLink>
                <ButtonLink href={ROUTES.providers} tone="secondary">
                  For healthcare providers
                </ButtonLink>
              </div>
            </div>

            <ul className="mt-14 grid gap-4 lg:grid-cols-3">
              {product.capabilities.map(capability => (
                <li key={capability.title}>
                  <Card className="flex h-full flex-col gap-2.5 p-7">
                    <Display as="h2" size="sm">
                      {capability.title}
                    </Display>
                    <p className="text-[15px]/relaxed text-muted">{capability.body}</p>
                  </Card>
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
          title="Start with one department."
          lede="Pilots begin with one facility, one department, and the records you already hold."
          primary="Book an EHR demo"
          secondary="Hospital sign in"
          secondaryHref={APP_ENTRY.staffSignIn}
        />
      </main>
      <SiteFooter />
      <DemoDialog />
    </>
  )
}
