import Link from 'next/link'
import { Card, Display } from '@hid/ui'
import type { Product } from '@/content/products'
import { ROUTES } from '@/content/site'

export function ProductCard({ product, compact = false }: { product: Pick<Product, 'slug' | 'mark' | 'name' | 'summary'>; compact?: boolean }) {
  return <Link href={ROUTES.product(product.slug)} className="flex flex-1 rounded-(--radius-panel) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
    <Card className={`flex flex-1 flex-col gap-3 ${compact ? 'p-5' : 'p-7'} transition-[background-color,border-color] duration-150 hover:border-brand-border hover:bg-surface-hover`}>
      <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-lg bg-brand-tint font-mono text-[12px] font-semibold text-brand">{product.mark}</span>
      <Display as={compact ? 'h3' : 'h2'} size="sm">{product.name}</Display>
      <p className={`${compact ? 'text-sm/relaxed' : 'text-[15px]/relaxed'} text-muted`}>{product.summary}</p>
      <span className="mt-auto pt-2 font-semibold text-brand">Explore <span aria-hidden="true">&rarr;</span></span>
    </Card>
  </Link>
}
