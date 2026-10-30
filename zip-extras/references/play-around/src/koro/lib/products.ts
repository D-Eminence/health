import type { Category, Product, Seller } from './types'

export const CATEGORIES: Category[] = [
  { id: 'fashion', name: 'Fashion', slug: 'fashion', description: 'Everyday essentials' },
  { id: 'electronics', name: 'Electronics', slug: 'electronics', description: 'Audio, wearables and tech' },
  { id: 'beauty', name: 'Beauty', slug: 'beauty', description: 'Skincare and body care' },
  { id: 'food', name: 'Food', slug: 'food', description: 'Pantry and provisions' },
  { id: 'home', name: 'Home', slug: 'home', description: 'Objects for a calmer home' },
  { id: 'services', name: 'Services', slug: 'services', description: 'Book a professional' },
]

const SELLERS: Record<string, Seller> = {
  amowa: { id: 'amowa', name: 'Amowa Luxe', rating: 4.8, orderCount: 1204, verified: true, whatsapp: '2348012345678' },
  volt: { id: 'volt', name: 'Volt Audio NG', rating: 4.7, orderCount: 862, verified: true, whatsapp: '2348023456789' },
  techtide: { id: 'techtide', name: 'Techtide Store', rating: 4.5, orderCount: 2318, verified: true, whatsapp: '2348034567890' },
  glow: { id: 'glow', name: 'Glow Republic', rating: 4.9, orderCount: 3041, verified: true, whatsapp: '2348045678901' },
  hearth: { id: 'hearth', name: 'Hearth & Co', rating: 4.7, orderCount: 288, verified: true, whatsapp: '2348056789012' },
  pantry: { id: 'pantry', name: 'Naija Pantry', rating: 4.7, orderCount: 402, verified: true, whatsapp: '2348067890123' },
  lumen: { id: 'lumen', name: 'Lumen Studio', rating: 4.9, orderCount: 88, verified: true, whatsapp: '2348078901234' },
  kito: { id: 'kito', name: 'Kito Home', rating: 4.3, orderCount: 176, verified: false, whatsapp: '2348089012345' },
}

const img = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`

export const PRODUCTS: Product[] = [
  // Fashion
  { id: 'p1', name: 'Premium Cotton Shirt', slug: 'premium-cotton-shirt', description: 'A crisp, breathable 100% cotton shirt with a tailored fit that holds its shape wash after wash.', categoryId: 'fashion', price: 25000, rating: 4.6, reviewCount: 53, stockQuantity: 12, imageUrl: img('photo-1521572163474-6864f9cf17ab'), sku: 'KRO-FA-001', active: true, featured: true, seller: SELLERS.amowa },
  { id: 'p2', name: 'Minimal Leather Sneakers', slug: 'minimal-leather-sneakers', description: 'Clean full-grain leather sneakers with a cushioned insole and a tonal rubber cupsole.', categoryId: 'fashion', price: 95000, compareAtPrice: 110000, rating: 4.6, reviewCount: 27, stockQuantity: 9, imageUrl: img('photo-1542291026-7eec264c27ff'), sku: 'KRO-FA-002', active: true, tags: ['deal'], seller: SELLERS.amowa },
  // Electronics
  { id: 'p3', name: 'Wireless Noise-Cancelling Headphones', slug: 'wireless-noise-cancelling-headphones', description: 'Over-ear headphones with adaptive noise cancellation and 40-hour battery life.', categoryId: 'electronics', price: 185000, compareAtPrice: 210000, rating: 4.8, reviewCount: 41, stockQuantity: 16, imageUrl: img('photo-1505740420928-5e560c06d30e'), sku: 'KRO-EL-001', active: true, featured: true, seller: SELLERS.volt },
  { id: 'p4', name: 'Smart Watch Pro', slug: 'smart-watch-pro', description: 'A slim 45mm smartwatch with AMOLED display, GPS and seven days of battery.', categoryId: 'electronics', price: 98000, compareAtPrice: 120000, rating: 4.5, reviewCount: 87, stockQuantity: 20, imageUrl: img('photo-1523275335684-37898b6baf30'), sku: 'KRO-EL-002', active: true, featured: true, seller: SELLERS.techtide },
  { id: 'p5', name: 'Portable Bluetooth Speaker', slug: 'portable-bluetooth-speaker', description: 'Compact speaker with rich sound, 12-hour playtime and an IPX6 water-resistant build.', categoryId: 'electronics', price: 64500, rating: 4.5, reviewCount: 63, stockQuantity: 28, imageUrl: img('photo-1608043152269-423dbba4e7e1'), sku: 'KRO-EL-003', active: true, seller: SELLERS.volt },
  // Beauty
  { id: 'p6', name: 'Daily Skincare Set', slug: 'daily-skincare-set', description: 'A gentle three-step routine — cleanser, serum and moisturizer — for everyday use.', categoryId: 'beauty', price: 58000, rating: 4.9, reviewCount: 44, stockQuantity: 18, imageUrl: img('photo-1556228720-195a672e8a03'), sku: 'KRO-BE-001', active: true, featured: true, seller: SELLERS.glow },
  { id: 'p7', name: 'Body Care Essentials', slug: 'body-care-essentials', description: 'A hydrating body wash and lotion duo with shea butter and a light, clean fragrance.', categoryId: 'beauty', price: 24000, compareAtPrice: 29000, rating: 4.6, reviewCount: 38, stockQuantity: 24, imageUrl: img('photo-1608571423902-eed4a5ad8108'), sku: 'KRO-BE-002', active: true, tags: ['deal'], seller: SELLERS.glow },
  // Food
  { id: 'p8', name: 'Single-Origin Cocoa Box', slug: 'single-origin-cocoa-box', description: 'Small-batch Nigerian cocoa and dark chocolate tasting box, sourced from Ondo farms.', categoryId: 'food', price: 18000, rating: 4.7, reviewCount: 31, stockQuantity: 40, imageUrl: img('photo-1511381939415-e44015466834'), sku: 'KRO-FO-001', active: true, seller: SELLERS.pantry },
  { id: 'p9', name: 'Cold-Pressed Palm Oil 2L', slug: 'cold-pressed-palm-oil-2l', description: 'Unrefined, cold-pressed red palm oil in a 2-litre food-grade container.', categoryId: 'food', price: 12500, rating: 4.6, reviewCount: 52, stockQuantity: 60, imageUrl: img('photo-1474979266404-7eaacbcd87c5'), sku: 'KRO-FO-002', active: true, seller: SELLERS.pantry },
  // Home
  { id: 'p10', name: 'Ceramic Table Lamp', slug: 'ceramic-table-lamp', description: 'A sculptural ceramic lamp with a warm linen shade that casts a soft, even glow.', categoryId: 'home', price: 54000, rating: 4.7, reviewCount: 33, stockQuantity: 11, imageUrl: img('photo-1507473885765-e6ed057f782c'), sku: 'KRO-HM-001', active: true, featured: true, seller: SELLERS.hearth },
  { id: 'p11', name: 'Portable Blender', slug: 'portable-blender', description: 'A rechargeable personal blender that makes smoothies in 30 seconds over USB-C.', categoryId: 'home', price: 36000, compareAtPrice: 42000, rating: 4.3, reviewCount: 72, stockQuantity: 22, imageUrl: img('photo-1570222094114-d054a817e56b'), sku: 'KRO-HM-002', active: true, tags: ['deal'], seller: SELLERS.kito },
  // Services
  { id: 'p12', name: 'Studio Product Photography', slug: 'studio-product-photography', description: 'A half-day studio session producing 20 edited product images for your store.', categoryId: 'services', price: 45000, rating: 4.9, reviewCount: 18, stockQuantity: 6, imageUrl: img('photo-1520390138845-fd2d229dd553'), sku: 'KRO-SV-001', active: true, seller: SELLERS.lumen },
]

/* ---------------------------------------------------------------------------
 * Delivery pricing — the single source of truth for shipping fees.
 * ------------------------------------------------------------------------- */
export const DELIVERY_FEE_LAGOS = 5000
export const DELIVERY_FEE_OTHER = 8000
export const EXPRESS_SURCHARGE = 4000

export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
]

export function deliveryFeeFor(state: string): number {
  const normalized = state.trim().toLowerCase()
  return normalized === 'lagos' ? DELIVERY_FEE_LAGOS : DELIVERY_FEE_OTHER
}

export function getProductBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug)
}

export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id)
}

export function getCategoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug)
}

export function productsByCategory(categoryId: string): Product[] {
  return PRODUCTS.filter((p) => p.categoryId === categoryId && p.active)
}

export function featuredProducts(): Product[] {
  return PRODUCTS.filter((p) => p.featured && p.active)
}
