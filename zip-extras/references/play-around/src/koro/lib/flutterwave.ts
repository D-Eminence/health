/* ---------------------------------------------------------------------------
 * Flutterwave contract — the second payment gateway (SANDBOX/test mode).
 *
 * Uses the client-side Flutterwave Inline checkout (public key only), which
 * opens the real Flutterwave test environment. Verification is server-side;
 * this SPA simulates that step (see lib/payments.ts) and a production backend
 * would call GET /v3/transactions/{id}/verify with the secret key.
 * ------------------------------------------------------------------------- */

export const FLUTTERWAVE_PUBLIC_KEY = import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY as string | undefined

export type FlutterwaveStatus = 'successful' | 'failed' | 'cancelled' | 'pending'

export type FlutterwaveResponse = {
  status: FlutterwaveStatus
  tx_ref: string
  transaction_id?: number
  amount?: number
  currency?: string
}

let flutterwaveScriptPromise: Promise<void> | null = null

function loadFlutterwaveScript(): Promise<void> {
  if (!flutterwaveScriptPromise) {
    flutterwaveScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://checkout.flutterwave.com/v3.js"]')
      if (existing) return resolve()
      const s = document.createElement('script')
      s.src = 'https://checkout.flutterwave.com/v3.js'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Could not load Flutterwave.'))
      document.head.appendChild(s)
    })
  }
  return flutterwaveScriptPromise
}

type InlineOptions = {
  email: string
  amountNaira: number
  reference: string
  onSuccess: (response: FlutterwaveResponse) => void
  onClose: () => void
}

/** Opens the real Flutterwave inline checkout (test mode). Requires VITE_FLUTTERWAVE_PUBLIC_KEY. */
export async function openFlutterwaveInline({ email, amountNaira, reference, onSuccess, onClose }: InlineOptions): Promise<void> {
  if (!FLUTTERWAVE_PUBLIC_KEY) throw new Error('Flutterwave public key is not configured.')
  await loadFlutterwaveScript()
  const FlutterwaveCheckout = (
    window as unknown as { FlutterwaveCheckout?: (opts: Record<string, unknown>) => void }
  ).FlutterwaveCheckout
  if (!FlutterwaveCheckout) throw new Error('Could not load Flutterwave.')

  FlutterwaveCheckout({
    public_key: FLUTTERWAVE_PUBLIC_KEY,
    tx_ref: reference,
    // Flutterwave accepts the amount in the currency's base unit (Naira).
    amount: amountNaira,
    currency: 'NGN',
    payment_options: 'card,account,banktransfer,ussd',
    customer: { email },
    callback: (response: FlutterwaveResponse) => onSuccess(response),
    onclose: onClose,
  })
}
