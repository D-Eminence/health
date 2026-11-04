import { getEnvironment } from './env'
import { patientChatHost } from './chatFeatures'

/**
 * Whether this build offers sending the card by email and opening it with a code (step 8, hid-system 0118): the build's
 * VITE_HID_CARD_SHARES, on in every config since legal approved (owner, 4 Nov 2026), and only on the patient portal's own host
 * (the same hosts as the patient's chat). Off, no entry point is shown, no list is read, the page a link opens is
 * today's dormant page, and no card-share request is ever sent. On, every page still waits for the backend to say it
 * serves the routes (cardShares.ts).
 */
export function cardSharesEnabled(): boolean {
  // Fails closed: a configuration that cannot be read turns this off rather than on.
  try { return getEnvironment().cardSharesEnabled && patientChatHost() } catch { return false }
}
