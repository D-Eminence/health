import type { Metadata } from 'next'
import { Display, Section, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { BackToTop } from '@/components/shared/BackToTop'
import { DemoDialog } from '@/components/shared/DemoDialog'
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
            <p className="mt-4 text-base/relaxed text-muted">Set up a new hospital, clinic, laboratory, pharmacy, or other healthcare facility. Start with CAC verification and complete your administrator account from the secure Provider Portal.</p>
            <p className="mt-3 text-sm text-muted">Already have staff access? <a className="font-semibold text-brand underline underline-offset-4" href={APP_ENTRY.staffSignIn}>Sign in to the provider portal</a>.</p>
            <div className="mt-8 rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8>
              <h2 className="font-display text-2xl text-ink">Create your provider account</h2>
              <p className="mt-3 text-sm/relaxed text-muted">Start with your CAC registration number. Health ID verifies it through the official registry, confirms your administrator email, and creates your provider account when the organization passes the automated checks.</p>
              <a href={APP_ENTRY.providerSignUp}
                className="mt-6 inline-flex min-h-11 items-center justify-center rounded-(--radius-control) bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark">
                Verify CAC and set up facility
              </a>
              <p className="mt-4 text-xs/relaxed text-muted">Existing organizations, duplicate CAC records, or other exceptions are sent to HID Team review instead of being activated automatically.</p>
            </div>
          </div>
        </Wrap>
      </Section>
    </main>
    <SiteFooter />
    <BackToTop />
    <DemoDialog />
  </>
}
