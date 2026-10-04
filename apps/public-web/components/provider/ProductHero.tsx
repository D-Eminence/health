import { Eyebrow, Wrap } from '@hid/ui'
import { ProductDashboard } from '@/components/shared/ProductDashboard'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
import type { ProductDetail } from '@/content/product-details'

function headlineLines(title: string): readonly [string, string | null] {
  const boundary = title.indexOf('. ')
  return boundary === -1
    ? [title, null]
    : [title.slice(0, boundary + 1), title.slice(boundary + 2)]
}

/** Reusable, product-first hero for every Health ID module. */
export function ProductHero({ product }: { product: ProductDetail }) {
  const [primaryLine, accentLine] = headlineLines(product.title)
  return (
    <section className="relative isolate overflow-hidden bg-inverse-surface pt-12 sm:pt-16">
      <Wrap className="relative">
        <div className="mx-auto flex max-w-[1040px] flex-col items-center text-center">
          <Eyebrow tone="inverse" className="hero-reveal hero-reveal-1">{product.name.toUpperCase()}</Eyebrow>
          <h1 id="product-title" className="hero-reveal hero-reveal-2 mt-6 font-display text-[clamp(2.4375rem,4vw,3rem)] leading-[1.06] tracking-[-0.03em] text-balance">
            <span className="block text-white">{primaryLine}</span>
            {accentLine ? <span className="mt-1 block text-brand">{accentLine}</span> : null}
          </h1>
          <p className="hero-reveal hero-reveal-3 mt-5 max-w-[700px] text-[15px]/[1.45] text-white/72">{product.sub}</p>
          <div className="hero-reveal hero-reveal-4 mt-6 flex flex-wrap items-center justify-center gap-3 sm:mt-8">
            <HeroDemoButton />
          </div>
        </div>
      </Wrap>
      <div id="product-showcase" className="relative pt-16 sm:pt-20">
        <Wrap>
          <div className="hero-dashboard hero-product-stage product-hero-dashboard mx-auto max-w-[1160px]"><ProductDashboard product={product} /></div>
          <p className="mx-auto mt-4 max-w-[1160px] pb-5 text-center text-xs text-white/75">Illustrative product view. Names, figures and activity are examples, not live data.</p>
        </Wrap>
      </div>
    </section>
  )
}
