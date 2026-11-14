import type { Metadata } from 'next'
import { ProviderNav } from '@/components/layout/SiteNav'
import { ResourcesHub } from '@/components/resources/ResourcesHub'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { BackToTop } from '@/components/shared/BackToTop'
import { DemoDialog } from '@/components/shared/DemoDialog'

export const metadata: Metadata = {
  title: 'Resources',
  description: 'Guides to understanding Health ID, its products, security, privacy, and implementation.',
}

/** A searchable index of the published Health ID guidance. */
export default function ResourcesPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <ResourcesHub />
      </main>
      <SiteFooter cta />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
