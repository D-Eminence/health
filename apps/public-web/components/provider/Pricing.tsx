'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, Display, Section, SectionHeader, TextLink, Wrap } from '@hid/ui'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
import { PRICING } from '@/content/provider'
import { formatPublicPrice, readPublicPrices, type PublicPrice } from '@/lib/commercial-api'
import { isApplicationProduct, providerApplicationHref, PROVIDER_SETUP_CTA } from '@/lib/provider-application'

const PRODUCT_NAMES: Record<PublicPrice['product_slug'], string> = {
  identity: 'Health ID Identity',
  ehr: 'Health ID EHR',
  laboratory: 'Health ID Laboratory',
  pharmacy: 'Health ID Pharmacy',
  migrate: 'Health ID Migrate',
  outreach: 'Health ID Outreach',
  api: 'Health ID API',
}

function contextLabel(context: string): string {
  return context.replaceAll('_', ' ').replace(/^./, character => character.toUpperCase())
}

function periodLabel(price: PublicPrice): string {
  return [price.billing_period, price.unit].filter(Boolean).join(' · ')
}

export function PricingSection({ headingAs = 'h1' }: { headingAs?: 'h1' | 'h2' }) {
  const [prices, setPrices] = useState<PublicPrice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    setPrices(null)
    readPublicPrices(controller.signal)
      .then(setPrices)
      .catch(() => { if (!controller.signal.aborted) setError('Current pricing could not be loaded.') })
    return () => controller.abort()
  }, [version])

  const retry = useCallback(() => setVersion(current => current + 1), [])
  const grouped = prices?.reduce((map, price) => {
    const rows = map.get(price.product_slug) ?? []
    rows.push(price)
    map.set(price.product_slug, rows)
    return map
  }, new Map<PublicPrice['product_slug'], PublicPrice[]>())

  return (
    <Section id="pricing" tone="sunk" labelledBy="pricing-title">
      <Wrap>
        <SectionHeader eyebrow={PRICING.eyebrow} id="pricing-title" title={PRICING.title}
          lede={PRICING.lede} as={headingAs} />

        {error ? (
          <div role="alert" className="mx-auto mt-9 max-w-xl rounded-(--radius-card) border border-line-strong bg-surface p-6 text-center">
            <p className="text-sm text-muted">{error}</p>
            <button type="button" onClick={retry} className="mt-3 font-semibold text-brand underline">Try again</button>
          </div>
        ) : prices === null ? (
          <div role="status" aria-live="polite" className="mx-auto mt-9 max-w-xl rounded-(--radius-card) border border-line bg-surface p-6 text-center text-sm text-muted">
            Loading current pricing…
          </div>
        ) : grouped?.size === 0 ? (
          <div role="status" className="mx-auto mt-9 max-w-xl rounded-(--radius-card) border border-line bg-surface p-6 text-center text-sm text-muted">
            Pricing is being configured. Contact us for a quote.
          </div>
        ) : (
          <ul className="mx-auto mt-10 grid max-w-[1080px] gap-5 md:grid-cols-2 xl:grid-cols-3">
            {[...(grouped?.entries() ?? [])].map(([slug, rows]) => (
              <li key={slug} className="flex">
                <Card glass className="flex flex-1 flex-col gap-5 p-7">
                  <Display as="h3" size="sm">{PRODUCT_NAMES[slug]}</Display>
                  <ul className="flex flex-col gap-4 border-t border-line pt-4">
                    {rows.map(price => (
                      <li key={price.context} className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-faint">{contextLabel(price.context)}</span>
                        <span className="text-xl font-semibold text-ink">{formatPublicPrice(price)}</span>
                        {periodLabel(price) ? <span className="text-sm text-muted">{periodLabel(price)}</span> : null}
                      </li>
                    ))}
                  </ul>
                  {isApplicationProduct(slug)
                    ? <HeroDemoButton href={providerApplicationHref(slug)} className="mt-auto w-full">{PROVIDER_SETUP_CTA}</HeroDemoButton>
                    : <HeroDemoButton className="mt-auto w-full">Book a demo</HeroDemoButton>}
                </Card>
              </li>
            ))}
          </ul>
        )}

        <div className="mx-auto mt-8 flex max-w-[720px] flex-col items-center gap-3 text-center">
          <p className="text-[15px] text-muted">{PRICING.enterprise}</p>
          <TextLink href="#demo">{PRICING.enterpriseAction} <span aria-hidden="true">&rarr;</span></TextLink>
          <p className="mt-2 text-[13px]/relaxed text-faint">{PRICING.footnote}</p>
        </div>
      </Wrap>
    </Section>
  )
}
