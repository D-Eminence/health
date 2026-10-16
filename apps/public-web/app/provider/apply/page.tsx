import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { APP_ENTRY } from '@/content/site'
import { isApplicationProduct } from '@/lib/provider-application'

export const metadata: Metadata = {
  title: 'Setup Your Facility',
  description: 'Apply for Health ID EHR, Migrate, Laboratory, or Pharmacy access for your facility.',
}

/**
 * Facility setup lives in the Provider Portal, where enrollment keeps its
 * session from the CAC check through to the authenticator. Every "Setup Your
 * Facility" link on the public site lands here and is sent on, keeping the
 * product the visitor chose so the portal's form opens with it selected.
 */
export default async function ProviderApplyPage({ searchParams }: {
  searchParams: Promise<{ product?: string | string[] }>
}) {
  const query = await searchParams
  const product = typeof query.product === 'string' && isApplicationProduct(query.product) ? query.product : undefined
  redirect(product ? `${APP_ENTRY.providerSignUp}?product=${product}` : APP_ENTRY.providerSignUp)
}
