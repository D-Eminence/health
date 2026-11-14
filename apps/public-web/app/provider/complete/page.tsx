import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ProviderCompletionContent } from './ProviderCompletionContent'

export const metadata: Metadata = {
  title: 'Complete your facility profile',
  description: 'Complete missing organization details after Health ID verifies your facility registration.',
}

export default function Page() {
  return <Suspense fallback={<main role="status">Opening facility form?</main>}><ProviderCompletionContent /></Suspense>
}
