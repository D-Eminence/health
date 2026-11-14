'use client'

import { useSearchParams } from 'next/navigation'
import { Section, SectionHeader, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { isApplicationProduct, type ApplicationProductCode } from '@/lib/provider-application'
import { ProviderCompletionForm } from './ProviderCompletionForm'



export function ProviderCompletionContent() {
  const product = useSearchParams().get('product')
  const initialProduct: ApplicationProductCode = typeof product === 'string' && isApplicationProduct(product)
    ? product : 'ehr'

  return (
    <>
      <ProviderNav applicationProduct={initialProduct} />
      <main id="main">
        <Section labelledBy="provider-completion-title" tone="sunk">
          <Wrap>
            <SectionHeader
              eyebrow="Organization onboarding"
              id="provider-completion-title"
              title="Complete your facility profile."
              lede="After your CAC registration is verified, you can supply details the registry did not return. Health ID reviews the completed profile before granting access."
              as="h1"
            />
            <ProviderCompletionForm key={initialProduct} initialProduct={initialProduct} />
          </Wrap>
        </Section>
      </main>
      <SiteFooter />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
