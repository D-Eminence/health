import { getProductById } from './products'
import type { CartLine, Product } from './types'

export type HydratedLine = {
  product: Product
  quantity: number
  lineTotal: number
}

export function hydrateCart(lines: CartLine[]): HydratedLine[] {
  return lines
    .map((l) => {
      const product = getProductById(l.productId)
      if (!product) return null
      return { product, quantity: l.quantity, lineTotal: product.price * l.quantity }
    })
    .filter((x): x is HydratedLine => x !== null)
}

export function cartSubtotal(hydrated: HydratedLine[]): number {
  return hydrated.reduce((n, l) => n + l.lineTotal, 0)
}
