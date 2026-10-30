import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { delay, effectiveStock } from '../lib/db'
import { getProductById } from '../lib/products'
import { useCart } from './CartContext'
import { useToast } from './ToastContext'

/** Shared add-to-cart flow: loading button → "Adding to cart…" → "Added to cart". */
export function useAddToCart() {
  const { addItem } = useCart()
  const toast = useToast()
  const navigate = useNavigate()
  const [addingId, setAddingId] = useState<string | null>(null)

  async function add(
    productId: string,
    quantity = 1,
    options?: { showViewCart?: boolean },
  ): Promise<boolean> {
    const product = getProductById(productId)
    if (!product) return false
    const stock = effectiveStock(productId)
    if (stock <= 0) {
      toast.warning('Item unavailable', `${product.name} is out of stock.`)
      return false
    }
    if (addingId) return false

    setAddingId(productId)
    const id = toast.loading('Adding to cart…', product.name)
    await delay(350)
    addItem(productId, quantity)
    setAddingId(null)

    const remaining = stock - quantity
    const message =
      remaining <= 5
        ? `${product.name} has been added to your cart. Only ${remaining} left in stock.`
        : `${product.name} has been added to your cart.`

    toast.update(id, {
      type: 'success',
      title: 'Added to cart',
      message,
      action:
        options?.showViewCart === false
          ? undefined
          : { label: 'View cart', onAction: () => navigate('/cart') },
    })
    return true
  }

  return { add, addingId }
}
