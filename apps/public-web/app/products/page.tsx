import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, Display, Section, SectionHeader, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { PRODUCTS } from '@/content/products'
import { ROUTES } from '@/content/site'

export const metadata: Metadata = {
  title: 'Products',
  description:
    'The Health ID modules: EHR, Laboratory, Pharmacy, Identity, Connect, Migrate and the API.',
}

export default function ProductsPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="products-title">
          <Wrap>
            <SectionHeader
              eyebrow="Products"
              id="products-title"
              title="One identity. Every system."
              lede="Each module works on its own and connects to the same patient identity, so a facility can adopt one department at a time."
            />

            <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {PRODUCTS.map(product => (
                <li key={product.slug} className="flex">
                  <Link href={ROUTES.product(product.slug)} className="flex flex-1">
                    <Card className="flex flex-1 flex-col gap-3 p-7 transition-shadow hover:shadow-[0_12px_36px_rgba(11,27,46,0.10)]">
                      <span
                        aria-hidden="true"
                        className="grid h-9 w-9 place-items-center rounded-lg bg-brand-tint font-mono text-[12px] font-semibold text-brand"
                      >
                        {product.mark}
                      </span>
                      <Display as="h2" size="sm">
                        {product.name}
                      </Display>
                      <p className="text-[15px]/relaxed text-muted">{product.summary}</p>
                      <span className="mt-auto pt-2 font-semibold text-brand">
                        Explore <span aria-hidden="true">&rarr;</span>
                      </span>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </Wrap>
        </Section>
      </main>
      <SiteFooter />
      <DemoDialog />
    </>
  )
}
