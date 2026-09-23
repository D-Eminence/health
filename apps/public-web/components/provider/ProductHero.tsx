import Image from 'next/image'
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
    <section className="relative isolate overflow-hidden bg-[#05090f] pt-12 sm:pt-16">
      <Image src="/brand/patient-hero-grid.jpg" alt="" fill priority className="-z-20 object-cover object-center opacity-55" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/80" />
      <Wrap className="relative">
        <div className="mx-auto flex max-w-[1040px] flex-col items-center text-center">
          <Eyebrow tone="outline" className="hero-reveal hero-reveal-1 border-white/25 bg-white/10 text-white">{product.name.toUpperCase()}</Eyebrow>
          <h1 id="product-title" className="hero-reveal hero-reveal-2 mt-6 font-display text-[clamp(3.25rem,7.2vw,5.5rem)] leading-[0.96] tracking-[-0.04em] text-balance">
            <span className="block text-white">{primaryLine}</span>
            {accentLine ? <span className="mt-1 block text-[#0088ff]">{accentLine}</span> : null}
          </h1>
          <p className="hero-reveal hero-reveal-3 mt-7 max-w-[700px] text-[18px]/relaxed text-white/72 sm:text-[21px]/relaxed">{product.sub}</p>
          <div className="hero-reveal hero-reveal-4 mt-10 flex flex-wrap items-center justify-center gap-3 sm:mt-12">
            <HeroDemoButton />
          </div>
        </div>
      </Wrap>
      <div id="product-showcase" className="relative pt-16 sm:pt-20">
        <Wrap><div className="hero-dashboard hero-product-stage product-hero-dashboard mx-auto max-w-[1160px]"><ProductDashboard product={product} /></div></Wrap>
      </div>
    </section>
  )
}
