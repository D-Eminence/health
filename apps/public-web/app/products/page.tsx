import type { Metadata } from 'next'
import { Section, SectionHeader, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { PRODUCTS } from '@/content/products'
import { ProductCard } from '@/components/product/ProductCard'

export const metadata: Metadata = {
  title: 'Products',
  description:
    'The Health ID modules: Identity, EHR, Migrate, Laboratory, Pharmacy, Outreach and the API.',
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
              title="Every product in the Health ID ecosystem."
              lede="Each module works on its own and connects to the same patient identity, so a facility can adopt one department at a time."
              as="h1"
            />

            <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {PRODUCTS.map(product => (
                <li key={product.slug} className="flex">
                  <ProductCard product={product} />
                </li>
              ))}
            </ul>
          </Wrap>
        </Section>
      </main>
      <SiteFooter cta />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
