import type { Metadata } from 'next'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { PricingSection } from '@/components/provider/Pricing'
import { PRICING } from '@/content/provider'

export const metadata: Metadata = {
  title: PRICING.title,
  description: 'Current Health ID product pricing and quote options for healthcare providers.',
}

/**
 * Pricing.
 *
 * The pricing page uses the backend catalogue; the provider homepage shows it too.
 */
export default function PricingPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <PricingSection />
      </main>
      <SiteFooter cta />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
