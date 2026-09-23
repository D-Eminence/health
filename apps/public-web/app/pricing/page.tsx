import type { Metadata } from 'next'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { PricingSection } from '@/components/provider/Pricing'
import { PRICING } from '@/content/provider'

export const metadata: Metadata = {
  title: PRICING.title,
  description:
    'Clinic and Hospital plans for Health ID, billed monthly or yearly, with migration and implementation quoted separately.',
}

/**
 * Pricing.
 *
 * The pricing page carries the full plan comparison; a summary also appears on
 * the healthcare provider homepage.
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
