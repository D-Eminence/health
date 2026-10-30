export type Category = {
  id: string
  name: string
  slug: string
  description: string
}

export type Seller = {
  id: string
  name: string
  rating: number
  orderCount: number
  verified: boolean
  whatsapp: string
}

export type Product = {
  id: string
  name: string
  slug: string
  description: string
  categoryId: string
  /** Price in whole Naira (NGN). */
  price: number
  compareAtPrice?: number
  rating: number
  reviewCount: number
  stockQuantity: number
  imageUrl: string
  sku: string
  active: boolean
  featured?: boolean
  tags?: string[]
  seller: Seller
}

export type CartLine = {
  productId: string
  quantity: number
}

/* --------------------------- Account / identity -------------------------- */

/** The authenticated platform user (account owner). */
export type User = {
  id: string
  name: string
  email: string
  phone: string
}

export type Address = {
  id: string
  label: string
  address: string
  city: string
  state: string
  postalCode?: string
  isDefault?: boolean
}

export type UserProfile = {
  user: User
  addresses: Address[]
}

/** Who order-related communication goes to (defaults to the account user). */
export type Contact = {
  name: string
  email: string
  phone: string
}

/** Who physically receives the order — may differ from the account user. */
export type Recipient = {
  name: string
  phone: string
  email?: string
}

/** Where the order is delivered (Nigerian address model). */
export type DeliveryAddress = {
  address: string
  city: string
  state: string
  postalCode?: string
  instructions?: string
}

/* -------------------------------- Orders -------------------------------- */

export type PaymentStatus = 'pending' | 'processing' | 'successful' | 'failed' | 'cancelled' | 'refunded'
export type OrderStatus = 'pending_payment' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'

export type OrderItem = {
  id: string
  productId: string
  productName: string
  quantity: number
  /** Price snapshot in Naira — historical orders never change with catalog edits. */
  unitPrice: number
  subtotal: number
  imageUrl: string
}

export type Payment = {
  id: string
  orderId: string
  reference: string
  provider: 'bachs' | 'flutterwave' | 'demo'
  amount: number
  currency: 'NGN'
  status: PaymentStatus
  providerTransactionId?: string
  paidAt?: string
  createdAt: string
  updatedAt: string
}

export type Order = {
  id: string
  orderNumber: string
  /** The account that placed the order (the order stays associated with it). */
  accountUserId?: string
  /** Order-related communication (may differ from the recipient). */
  contact: Contact
  /** Who receives the physical product (may differ from the account user). */
  recipient: Recipient
  /** Where the order is delivered. */
  delivery: DeliveryAddress
  items: OrderItem[]
  subtotal: number
  deliveryFee: number
  discount: number
  total: number
  status: OrderStatus
  payment: Payment
  createdAt: string
  updatedAt: string
}

export type CartTotals = {
  itemCount: number
  subtotal: number
  deliveryFee: number
  discount: number
  total: number
}
