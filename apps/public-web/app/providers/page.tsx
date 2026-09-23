import type { Metadata } from 'next'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { ProviderHero } from '@/components/provider/Hero'
import { TrustStrip } from '@/components/provider/TrustStrip'
import { ProductsSection } from '@/components/provider/Products'
import { PricingSection } from '@/components/provider/Pricing'
import { ProviderClosing } from '@/components/provider/Closing'
import { ROUTES } from '@/content/site'

export const metadata: Metadata = {
  title: 'For healthcare providers',
  description:
    'One connected healthcare platform for patient identity, electronic health records, laboratory, pharmacy and outreach — with legacy record migration built in.',
}

/**
 * The healthcare provider homepage.
 *
 * The provider overview page includes five main sections:
 *
 *   1. the hero, and the product itself beneath it
 *   2. why Health ID, in four benefits
 *   3. the product switcher, which is the gateway to the ecosystem
 *   4. clinic and hospital pricing
 *   5. the closing call to action
 *
 * The page answers what Health ID is, why it matters, which product a reader
 * needs, and what the plans cost.
 *
 * Only the navigation, the product switcher and the demo dialog opt into the
 * client, which keeps the page cheap to render and fast to load.
 */
export default function ProvidersPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <ProviderHero />
        <TrustStrip />
        <ProductsSection />
        <PricingSection headingAs="h2" />
        <ProviderClosing
          title="Get in touch."
          lede="Talk with the Health ID team about connecting your healthcare operations."
          primary="Book a demo"
          secondary="Contact us"
          secondaryHref={ROUTES.contact}
        />
      </main>
      <SiteFooter cta />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
