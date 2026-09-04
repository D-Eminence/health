import { ButtonLink, Eyebrow, Wrap } from '@hid/ui'
import { PROVIDER_HERO } from '@/content/provider'
import { ROUTES } from '@/content/site'
import { FacilityDashboard } from './FacilityDashboard'

/**
 * The provider hero.
 *
 * The backdrop is decorative, so it carries an empty alt and sits behind the
 * content rather than being announced. The dashboard beneath the fold-line
 * overlaps the hero deliberately — it is the product, and showing it early is
 * the point of the page.
 */
export function ProviderHero() {
  return (
    <section className="relative overflow-hidden">
      {/* Decorative backdrop. Kept as a background layer so no screen reader
          encounters it and no assistive user waits for it to load. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[620px] bg-[url('/brand/hero-backdrop.webp')] bg-cover bg-top opacity-70"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[620px] bg-linear-to-b from-surface/40 via-surface/70 to-surface"
      />

      <Wrap className="relative pt-16 pb-0 sm:pt-20">
        <div className="flex flex-col items-center gap-6 text-center">
          <Eyebrow tone="outline">{PROVIDER_HERO.eyebrow}</Eyebrow>

          <h1 className="font-display text-[clamp(2.375rem,5.4vw,4.25rem)] leading-[1.04] font-normal tracking-[-0.025em] text-balance">
            {PROVIDER_HERO.headline}
            <br className="hidden sm:block" />{' '}
            <span className="text-brand">{PROVIDER_HERO.headlineAccent}</span>
          </h1>

          <p className="max-w-[660px] text-base/relaxed text-muted">{PROVIDER_HERO.lede}</p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="#demo">{PROVIDER_HERO.primary}</ButtonLink>
            <ButtonLink href={ROUTES.product('ehr')} tone="secondary">
              {PROVIDER_HERO.secondary} <span aria-hidden="true">&rarr;</span>
            </ButtonLink>
          </div>
        </div>

        <div className="mt-14 sm:mt-16">
          <FacilityDashboard />
        </div>
      </Wrap>
    </section>
  )
}
