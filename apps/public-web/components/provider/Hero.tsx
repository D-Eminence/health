import { HeroBackground } from '@/components/shared/HeroBackground'
import { Eyebrow, Wrap } from '@hid/ui'
import { PROVIDER_HERO } from '@/content/provider'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
import { FacilityDashboard } from './FacilityDashboard'

/**
 * The provider hero.
 *
 * No video: the page is white, and the depth comes from a static tinted wash
 * with the product sitting on a frosted plinth. The wash is not decoration for
 * its own sake — frosted glass is only frosted when there is something behind it
 * to refract, so the two decisions belong together.
 *
 * The wash is static and decorative: it must never move against the dashboard,
 * which is the one thing on this screen worth looking at.
 */
export function ProviderHero() {
  return (
    <section className="relative isolate overflow-hidden bg-[#05090f]">
      <HeroBackground priority />

      <Wrap className="relative pt-16 pb-0 sm:pt-20">
        <div className="flex flex-col items-center gap-6 text-center">
          <Eyebrow tone="outline" className="border-white/25 bg-white/10 text-white">
            {PROVIDER_HERO.eyebrow}
          </Eyebrow>

          <h1 className="font-display text-[clamp(2.625rem,7.2vw,5.5rem)] leading-[0.98] font-normal tracking-[-0.035em] text-balance text-white">
            {PROVIDER_HERO.headline}
            <br className="hidden sm:block" />{' '}
            <span className="text-[#0088ff]">{PROVIDER_HERO.headlineAccent}</span>
          </h1>

          <p className="max-w-[660px] text-base/relaxed text-white/72">{PROVIDER_HERO.lede}</p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <HeroDemoButton />
          </div>
        </div>
      </Wrap>

      {/* The product, on a frosted plinth. Everything above exists to get the
          reader to this panel. */}
      <Wrap className="relative mt-14 sm:mt-16">
        <div className="hero-dashboard hero-product-stage provider-hero-dashboard mx-auto max-w-[1160px]">
          <FacilityDashboard />
        </div>
      </Wrap>
    </section>
  )
}
