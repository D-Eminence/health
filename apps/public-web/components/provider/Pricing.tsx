'use client'

import { useId, useState } from 'react'
import { Card, Display, Section, SectionHeader, TextLink, Wrap, cx } from '@hid/ui'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
import { HealthIcon } from '@/components/shared/HealthIcon'
import { PRICING } from '@/content/provider'
import { annualSaving, formatNaira, monthlyRate, type Billing } from '@/lib/pricing'

export function PricingSection({ headingAs = 'h1' }: { headingAs?: 'h1' | 'h2' }) {
  const [billing, setBilling] = useState<Billing>('monthly')
  const groupId = useId()

  return (
    <Section id="pricing" tone="sunk" labelledBy="pricing-title">
      <Wrap>
        <SectionHeader
          eyebrow={PRICING.eyebrow}
          id="pricing-title"
          title={PRICING.title}
          lede={PRICING.lede}
          as={headingAs}
        />

        {/*
          A two-option radio group rather than a checkbox or a pair of buttons:
          billing period is one choice from two, and radio semantics give
          keyboard users arrow-key movement for free.
        */}
        <fieldset className="mt-9 flex justify-center">
          <legend className="sr-only">Billing period</legend>
          <div className="inline-flex items-center gap-1 rounded-(--radius-control) border border-line bg-surface p-1">
            {(['monthly', 'yearly'] as const).map(option => (
              <label
                key={option}
                className={cx(
                  'cursor-pointer rounded-(--radius-control) px-5 py-2 text-sm font-semibold transition-colors',
                  'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand',
                  billing === option ? 'bg-brand text-white' : 'text-muted hover:text-ink',
                )}
              >
                <input
                  type="radio"
                  name={groupId}
                  value={option}
                  checked={billing === option}
                  onChange={() => setBilling(option)}
                  className="sr-only"
                />
                {option === 'monthly' ? 'Monthly' : 'Yearly'}
                {option === 'yearly' ? (
                  <span
                    className={cx(
                      'ml-2 text-[11px] font-medium',
                      billing === 'yearly' ? 'text-white/80' : 'text-brand',
                    )}
                  >
                    Save 20%
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>

        <ul className="mx-auto mt-10 grid max-w-[820px] gap-5 md:grid-cols-2">
          {PRICING.plans.map(plan => {
            const rate = monthlyRate(plan.monthlyNaira, billing)

            return (
              <li key={plan.name} className="flex">
                <Card
                  glass
                  className={cx(
                    'flex flex-1 flex-col gap-4 p-7',
                    plan.badge && 'border-brand ring-1 ring-brand',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <Display as="h3" size="sm">
                      {plan.name}
                    </Display>
                    {plan.badge ? (
                      <span className="rounded-(--radius-control) bg-brand-tint px-3 py-1 text-[11px] font-semibold text-brand">
                        {plan.badge}
                      </span>
                    ) : null}
                  </div>

                  <p className="text-sm/relaxed text-muted">{plan.audience}</p>

                  <p className="flex items-baseline gap-1.5">
                    <span className="font-display text-[40px] leading-none text-ink tabular-nums">
                      {formatNaira(rate)}
                    </span>
                    <span className="text-sm text-muted">/ month</span>
                  </p>

                  {/* Announced politely: the figure above changes under the
                      reader when they switch billing, and this explains why. */}
                  <p aria-live="polite" className="min-h-5 text-[13px] font-medium text-positive">
                    {billing === 'yearly'
                      ? `Save ${formatNaira(annualSaving(plan.monthlyNaira))} annually`
                      : ''}
                  </p>

                  <ul className="flex flex-col gap-2.5 border-t border-line pt-4">
                    {plan.includes.map(item => (
                      <li key={item} className="flex items-start gap-2.5 text-[15px] text-ink">
                        <span aria-hidden="true" className="mt-1 shrink-0 text-brand"><HealthIcon name="check" size={14} /></span>
                        {item}
                      </li>
                    ))}
                  </ul>

                  <HeroDemoButton className="mt-auto w-full" />
                </Card>
              </li>
            )
          })}
        </ul>

        <div className="mx-auto mt-8 flex max-w-[720px] flex-col items-center gap-3 text-center">
          <p className="text-[15px] text-muted">{PRICING.enterprise}</p>
          <TextLink href="#demo">
            {PRICING.enterpriseAction} <span aria-hidden="true">&rarr;</span>
          </TextLink>
          <p className="mt-2 text-[13px]/relaxed text-faint">{PRICING.footnote}</p>
        </div>
      </Wrap>
    </Section>
  )
}
