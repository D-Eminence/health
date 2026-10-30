import { z } from 'zod'
import { EXPRESS_SURCHARGE, deliveryFeeFor, getProductById } from './products'
import {
  cartLineSchema,
  contactSchema,
  deliveryAddressSchema,
  normalizeNigerianPhone,
  recipientSchema,
  type ContactInput,
  type DeliveryAddressInput,
  type RecipientInput,
} from './validation'
import { adjustStock, effectiveStock, generateId, nextOrderNumber, upsertOrder } from './db'
import { createPaymentReference } from './bachs'
import type { CartLine, Order, OrderItem, Payment } from './types'

export class OrderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderError'
  }
}

export type CreateOrderInput = {
  /** The authenticated account the order stays associated with. */
  accountUserId?: string
  contact: ContactInput
  recipient: RecipientInput
  delivery: DeliveryAddressInput
  lines: CartLine[]
  express?: boolean
}

/* ---------------------------------------------------------------------------
 * Authoritative order creation. The frontend total is never trusted: prices,
 * stock and delivery are re-derived from the catalog on every call.
 * ------------------------------------------------------------------------- */
export function createOrder(input: CreateOrderInput): Order {
  const contact = contactSchema.safeParse(input.contact)
  if (!contact.success) throw new OrderError('Invalid contact information. Please check your details.')
  const recipient = recipientSchema.safeParse(input.recipient)
  if (!recipient.success) throw new OrderError('Invalid recipient details. Please check who will receive the order.')
  const delivery = deliveryAddressSchema.safeParse(input.delivery)
  if (!delivery.success) throw new OrderError('Invalid delivery details. Please check the address.')
  const lines = z.array(cartLineSchema).min(1).safeParse(input.lines)
  if (!lines.success) throw new OrderError('Your cart is empty or contains invalid quantities.')

  const items: OrderItem[] = []
  let subtotal = 0

  for (const line of lines.data) {
    const product = getProductById(line.productId)
    if (!product || !product.active) throw new OrderError('A product in your cart is no longer available.')
    if (effectiveStock(product.id) < line.quantity) {
      throw new OrderError(`${product.name} is out of stock. Remove it and try again.`)
    }
    const unitPrice = product.price // authoritative catalog price
    const lineSubtotal = unitPrice * line.quantity
    items.push({
      id: generateId('item'),
      productId: product.id,
      productName: product.name,
      quantity: line.quantity,
      unitPrice,
      subtotal: lineSubtotal,
      imageUrl: product.imageUrl,
    })
    subtotal += lineSubtotal
  }

  const deliveryFee = deliveryFeeFor(delivery.data.state) + (input.express ? EXPRESS_SURCHARGE : 0)
  const discount = 0
  const total = subtotal + deliveryFee - discount
  const now = new Date().toISOString()
  const id = generateId('ord')
  const orderNumber = nextOrderNumber()

  const payment: Payment = {
    id: generateId('pay'),
    orderId: id,
    reference: createPaymentReference(),
    provider: 'demo',
    amount: total,
    currency: 'NGN',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }

  const order: Order = {
    id,
    orderNumber,
    accountUserId: input.accountUserId,
    contact: { ...contact.data, phone: normalizeNigerianPhone(contact.data.phone) },
    recipient: { ...recipient.data, phone: normalizeNigerianPhone(recipient.data.phone) },
    delivery: delivery.data,
    items,
    subtotal,
    deliveryFee,
    discount,
    total,
    status: 'pending_payment',
    payment,
    createdAt: now,
    updatedAt: now,
  }

  upsertOrder(order)
  return order
}
