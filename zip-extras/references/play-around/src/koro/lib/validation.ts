import { z } from 'zod'
import { NIGERIAN_STATES } from './products'

/* ---------------------------------------------------------------------------
 * Shared validation. Client-side improves UX; the order module re-runs the
 * authoritative checks server-side during checkout.
 * ------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// Nigerian mobile: 070/080/081/090/091 prefixes, 11 digits, or +234 international.
const NIGERIAN_PHONE_RE = /^(\+234|0)[789][01]\d{8}$/

export const customerSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.'),
  lastName: z.string().trim().min(1, 'Last name is required.'),
  email: z.string().trim().regex(EMAIL_RE, 'Enter a valid email address.'),
  phone: z
    .string()
    .trim()
    .refine((v) => NIGERIAN_PHONE_RE.test(v.replace(/[\s-]/g, '')), 'Enter a valid Nigerian phone number.'),
})

export const deliverySchema = z.object({
  address: z.string().trim().min(5, 'Enter a delivery address.'),
  city: z.string().trim().min(2, 'City is required.'),
  state: z.string().refine((v) => NIGERIAN_STATES.includes(v), 'Select a valid state.'),
  postalCode: z.string().trim().min(1, 'Postal code is required.'),
  instructions: z.string().optional(),
})

export const cartLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
})

/* ---------------------------------------------------------------------------
 * Contact (order communication) and Recipient (who receives the product) are
 * deliberately separate — the account holder is not always the recipient.
 * ------------------------------------------------------------------------- */

const phoneRule = (message: string) =>
  z.string().trim().refine((v) => NIGERIAN_PHONE_RE.test(v.replace(/[\s-]/g, '')), message)

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Full name is required.'),
  email: z.string().trim().regex(EMAIL_RE, 'Enter a valid email address.'),
  phone: phoneRule('Enter a valid Nigerian phone number.'),
})

export const recipientSchema = z.object({
  name: z.string().trim().min(1, "Enter the recipient's full name."),
  phone: phoneRule("Enter a valid phone number for the recipient."),
  email: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || EMAIL_RE.test(v), 'Enter a valid email address.'),
})

export const deliveryAddressSchema = z.object({
  address: z.string().trim().min(5, 'Enter a delivery address.'),
  city: z.string().trim().min(2, 'Enter a city.'),
  state: z.string().refine((v) => NIGERIAN_STATES.includes(v), 'Select a state.'),
  postalCode: z.string().trim().optional(),
  instructions: z.string().optional(),
})

export type ContactInput = z.infer<typeof contactSchema>
export type RecipientInput = z.infer<typeof recipientSchema>
export type DeliveryAddressInput = z.infer<typeof deliveryAddressSchema>

export const discountCodeSchema = z.string().trim().toUpperCase().max(24).optional()

export type CustomerInput = z.infer<typeof customerSchema>
export type DeliveryInput = z.infer<typeof deliverySchema>

/** Normalize a Nigerian phone number to a consistent +234 international form. */
export function normalizeNigerianPhone(raw: string): string {
  let digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+234')) return digits
  if (digits.startsWith('234')) return `+${digits}`
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`
  return digits
}

export function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}
