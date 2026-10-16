import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ProviderApplyRedirect } from './ProviderApplyRedirect'

export const metadata: Metadata = {
  title: 'Setup Your Facility',
  description: 'Apply for Health ID EHR, Migrate, Laboratory, or Pharmacy access for your facility.',
}

export default function Page() {
  return <Suspense fallback={<main id="main"><p role="status">Opening facility setup…</p></main>}><ProviderApplyRedirect /></Suspense>
}
