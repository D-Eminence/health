'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { productSignUpHref } from '@/content/site'
import { isApplicationProduct } from '@/lib/provider-application'

/**
 * Facility setup lives on each product's own site (owner, 2026-11-02: each product its own sign-up), where enrollment
 * keeps its session from the CAC check through to the administrator's password and where Identity accepts its security
 * check: a laboratory on Health ID Laboratory's, a pharmacy on Health ID Pharmacy's, a hospital on Health ID EHR's or
 * Health ID Migrate's. Every "Setup Your Facility" link on the public site lands here and is sent on to the chosen
 * product's site, keeping the product so its form opens with it; with none, to Health ID EHR's.
 *
 * The site is a static export (no server renders a request), so the query is read in the browser and the visitor is
 * sent on from there.
 */
export function ProviderApplyRedirect() {
  const product = useSearchParams().get('product')
  const target = productSignUpHref(product !== null && isApplicationProduct(product) ? product : null)
  useEffect(() => { window.location.replace(target) }, [target])
  return <main id="main"><p role="status">Opening facility setup…</p><p><a href={target}>Continue to facility setup</a></p></main>
}
