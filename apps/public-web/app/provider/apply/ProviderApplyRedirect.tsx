'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { APP_ENTRY } from '@/content/site'
import { isApplicationProduct } from '@/lib/provider-application'

/**
 * Facility setup lives in the Provider Portal on the main site, where
 * enrollment keeps its session from the CAC check through to the
 * administrator's password (and, on hid-system main, an authenticator), and
 * where Identity accepts its security check. Every "Setup Your
 * Facility" link on the public site lands here and is sent on, keeping the
 * product the visitor chose so the portal's form opens with it selected.
 *
 * The site is a static export (no server renders a request), so the query is
 * read in the browser and the visitor is sent on from there.
 */
export function ProviderApplyRedirect() {
  const product = useSearchParams().get('product')
  const chosen = product !== null && isApplicationProduct(product) ? product : undefined
  const target = chosen ? `${APP_ENTRY.providerSignUp}?product=${chosen}` : APP_ENTRY.providerSignUp
  useEffect(() => { window.location.replace(target) }, [target])
  return <main id="main"><p role="status">Opening facility setup…</p><p><a href={target}>Continue to facility setup</a></p></main>
}
