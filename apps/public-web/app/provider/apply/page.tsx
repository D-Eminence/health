import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ProviderApplyContent } from './ProviderApplyContent'

export const metadata: Metadata = {
  title: 'Setup Your Facility',
  description: 'Apply for Health ID EHR, Migrate, Laboratory, or Pharmacy access for your facility.',
}

export default function Page() {
  return <Suspense fallback={<main role="status">Opening facility form?</main>}><ProviderApplyContent /></Suspense>
}
