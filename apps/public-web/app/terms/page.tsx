import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/legal/LegalDocumentPage'
import { TERMS_OF_SERVICE } from '@/content/legal'

export const metadata: Metadata = {
  title: TERMS_OF_SERVICE.title,
  description: 'The Health ID Terms of Service you agree to when you create and use a Health ID.',
}

export default function TermsPage() {
  return <LegalDocumentPage document={TERMS_OF_SERVICE} />
}
