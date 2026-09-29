import { Eyebrow, Wrap } from '@hid/ui'
import { PROVIDER_HERO } from '@/content/provider'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
import { FacilityDashboard } from './FacilityDashboard'

/**
 * The provider hero.
 *
 * No video: the product preview carries this hero. The surrounding surface is
 * intentionally quiet so the first decision remains easy to scan.
 *
 * The wash is static and decorative: it must never move against the dashboard,
 * which is the one thing on this screen worth looking at.
 */
export function ProviderHero() {
  return (
    <section className="relative isolate overflow-hidden bg-inverse-surface">

      <Wrap className="relative pt-16 pb-0 sm:pt-20">
        <div className="flex flex-col items-center gap-6 text-center">
          <Eyebrow tone="inverse">
            {PROVIDER_HERO.eyebrow}
          </Eyebrow>

          <h1 className="font-display text-[clamp(2.4375rem,4vw,3rem)] leading-[1.06] font-normal tracking-[-0.03em] text-balance text-white">
            {PROVIDER_HERO.headline}
            <br className="hidden sm:block" />{' '}
            <span className="text-brand">{PROVIDER_HERO.headlineAccent}</span>
          </h1>

          <p className="max-w-[660px] text-[15px]/[1.45] text-white/72">{PROVIDER_HERO.lede}</p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <HeroDemoButton />
          </div>
        </div>
      </Wrap>

      {/* The product preview is the hero's concrete proof point. */}
      <Wrap className="relative mt-14 sm:mt-16">
        <div className="hero-dashboard hero-product-stage provider-hero-dashboard mx-auto max-w-[1160px]">
          <FacilityDashboard />
        </div>
      </Wrap>
    </section>
  )
}
