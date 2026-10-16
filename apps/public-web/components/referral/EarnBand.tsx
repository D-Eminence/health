import Link from 'next/link'
import { Section, Wrap } from '@hid/ui'
import { REFERRAL_BAND } from '@/content/referral'
import { ROUTES } from '@/content/site'

/** A short pointer to "Earn with Health ID", for pages that reach referrers. */
export function EarnBand() {
  return (
    <Section labelledBy="earn-band-title" tone="sunk">
      <Wrap>
        <div className="mx-auto flex max-w-[1080px] flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[620px]">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{REFERRAL_BAND.eyebrow}</p>
            <h2 id="earn-band-title" className="mt-3 font-display text-[clamp(1.875rem,3.2vw,2.5rem)] leading-[1.1] tracking-[-0.015em] text-balance text-ink">
              {REFERRAL_BAND.title}
            </h2>
            <p className="mt-3 text-[15px]/relaxed text-muted">{REFERRAL_BAND.body}</p>
          </div>
          <Link href={ROUTES.earn}
            className="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-(--radius-button) border border-ink px-5 text-sm font-semibold text-ink hover:bg-ink hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            {REFERRAL_BAND.action}
          </Link>
        </div>
      </Wrap>
    </Section>
  )
}
