import type { Metadata } from 'next'
import { Display, Section, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { BackToTop } from '@/components/shared/BackToTop'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { ProviderApplicationForm } from '@/components/provider/ProviderApplicationForm'
import { APP_ENTRY } from '@/content/site'
import { isApplicationProduct } from '@/lib/provider-application'

export const metadata: Metadata = {
  title: 'Setup Your Facility',
  description: 'Apply for Health ID EHR, Migrate, Laboratory, or Pharmacy access for your facility.',
}

export default async function ProviderApplyPage({ searchParams }: {
  searchParams: Promise<{ product?: string | string[] }>
}) {
  const query = await searchParams
  const product = typeof query.product === 'string' ? query.product : undefined

  return <>
    <ProviderNav applicationProduct={product && isApplicationProduct(product) ? product : undefined} />
    <main id="main">
      <Section labelledBy="provider-apply-title" tone="sunk">
        <Wrap>
          <div className="mx-auto max-w-[720px]">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">Organization onboarding</p>
            <Display as="h1" id="provider-apply-title" className="mt-4">Setup Your Facility</Display>
            <p className="mt-4 text-base/relaxed text-muted">Apply for a new hospital, clinic, laboratory, pharmacy, or other healthcare facility. Your facility type and product are reviewed through the existing Health ID organization application process.</p>
            <p className="mt-3 text-sm text-muted">Already have staff access? <a className="font-semibold text-brand underline underline-offset-4" href={APP_ENTRY.staffSignIn}>Sign in to the provider portal</a>.</p>
            <div className="mt-8"><ProviderApplicationForm product={product} /></div>
          </div>
        </Wrap>
      </Section>
    </main>
    <SiteFooter />
    <BackToTop />
    <DemoDialog />
  </>
}
