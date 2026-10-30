/* ---------------------------------------------------------------------------
 * Session / profile — the authenticated platform user.
 *
 * This module is the single source of the "logged-in user" for the checkout.
 * It currently returns a mock identity (the prototype default, per the brief:
 * "Ibrahim Akowide" is only the example identity, not hardcoded business
 * logic). Swap `getCurrentUser` / `getProfile` for your real auth + profile
 * API and every checkout screen picks up the real account data.
 * ------------------------------------------------------------------------- */
import type { Contact, UserProfile } from './types'

const PROFILE_KEY = 'koro.profile.v1'

const MOCK_PROFILE: UserProfile = {
  user: {
    id: 'usr_current',
    name: 'Ibrahim Akowide',
    email: 'ibrahim@example.com',
    phone: '0803 123 4567',
  },
  addresses: [
    {
      id: 'addr_home',
      label: 'Home',
      address: '12 Example Street',
      city: 'Ikeja',
      state: 'Lagos',
      postalCode: '100001',
      isDefault: true,
    },
  ],
}

/** The authenticated account user (null when signed out). */
export function getCurrentUser() {
  return getProfile().user
}

export function getProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? (JSON.parse(raw) as UserProfile) : MOCK_PROFILE
  } catch {
    return MOCK_PROFILE
  }
}

export function getContactFromProfile(): Contact {
  const { user } = getProfile()
  return { name: user.name, email: user.email, phone: user.phone }
}

export function getDefaultAddress() {
  const { addresses } = getProfile()
  return addresses.find((a) => a.isDefault) ?? addresses[0] ?? null
}

/** Only called when the user explicitly chooses to save changes to their profile. */
export function saveProfileContact(contact: Contact): void {
  try {
    const profile = getProfile()
    const next: UserProfile = { ...profile, user: { ...profile.user, ...contact } }
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}
