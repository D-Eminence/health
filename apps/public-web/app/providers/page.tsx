import type { Metadata } from 'next'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { ProviderHero } from '@/components/provider/Hero'
import {
  AdoptionSection,
  EhrSection,
  FeaturesSection,
  PartnerStrip,
  PlatformSection,
  StandardsSection,
} from '@/components/provider/Platform'
import {
  AccessSection,
  ApiSection,
  IdentitySection,
  MigrateSection,
  ProviderClosing,
} from '@/components/provider/Connected'
import { ModulesSection } from '@/components/provider/Modules'
import { OperationsSection } from '@/components/provider/Operations'
import { RecordSection, TeamsSection } from '@/components/provider/RecordAndTeams'
import { PricingSection } from '@/components/provider/Pricing'
import { PROVIDER_CTA } from '@/content/provider'
import { APP_ENTRY } from '@/content/site'

export const metadata: Metadata = {
  title: 'For healthcare providers',
  description:
    'Digitise consultations, records, laboratory results and prescriptions — with patient identity built into every encounter.',
}

/**
 * The healthcare provider landing page.
 *
 * Every section is a server component holding static content; only the pricing
 * toggle, the navigation menus and the demo dialog opt into the client. That
 * keeps the page cheap to render and fast to load, which is the reason this
 * application is on Next.js at all.
 */
export default function ProvidersPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <ProviderHero />
        <PartnerStrip />
        <PlatformSection />
        <AdoptionSection />
        <ModulesSection />
        <FeaturesSection />
        <EhrSection />
        <StandardsSection />
        <OperationsSection />
        <RecordSection />
        <TeamsSection />
        <IdentitySection />
        <AccessSection />
        <MigrateSection />
        <ApiSection />
        <PricingSection />
        <ProviderClosing
          title={PROVIDER_CTA.title}
          lede={PROVIDER_CTA.lede}
          primary={PROVIDER_CTA.primary}
          secondary={PROVIDER_CTA.secondary}
          secondaryHref={APP_ENTRY.staffSignIn}
        />
      </main>
      <SiteFooter />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
