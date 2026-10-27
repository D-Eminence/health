import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/legal/LegalDocumentPage'
import { PRIVACY_POLICY } from '@/content/legal'

export const metadata: Metadata = {
  title: PRIVACY_POLICY.title,
  description: 'How Health ID collects, uses, shares and protects your personal and health information.',
}

export default function PrivacyPolicyPage() {
  return <LegalDocumentPage document={PRIVACY_POLICY} />
}
