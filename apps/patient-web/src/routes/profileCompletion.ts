import type { EmergencyContact, PatientProfile } from '../api'
import type { HealthProfile, ProfileDetails } from '../profileParity'
import { ninVerifiedOf } from './NinVerificationCard'

/**
 * "Profile completion", computed in the page and never stored (hid-1.0 parity B3, contract D): twelve things, each
 * of equal weight, in this order. hid-1.0 counted sixteen and saved the result (PatientBioData.tsx:679-699);
 * identity.patients.profile_percent is that legacy value and is not read. Each item says where on the portal it is
 * filled in.
 */
export const COMPLETION_ITEMS = [
  { key: 'email', label: 'A verified email address', href: '/profile#contact-details' },
  { key: 'phone', label: 'A phone number', href: '/profile#contact-details' },
  { key: 'gender', label: 'Your gender', href: '/profile#bio-data' },
  { key: 'dateOfBirth', label: 'Your date of birth', href: '/profile#bio-data' },
  { key: 'state', label: 'Your state', href: '/profile#bio-data' },
  { key: 'photo', label: 'A photo on your card', href: '/profile?photo=add' },
  { key: 'hospital', label: 'The hospital you use', href: '/profile#coverage' },
  { key: 'hmo', label: 'Your HMO (health insurance)', href: '/profile#coverage' },
  { key: 'bloodGroup', label: 'Your blood group', href: '/profile#health-information' },
  { key: 'genotype', label: 'Your genotype', href: '/profile#health-information' },
  { key: 'nin', label: 'A verified NIN', href: '/profile#nin-verification' },
  { key: 'emergencyContact', label: 'An emergency contact', href: '/profile#emergency-contacts' },
] as const
export type CompletionItem = typeof COMPLETION_ITEMS[number]
export type CompletionKey = CompletionItem['key']

/**
 * What the count reads. A source left undefined (or null) was not served, or could not be read: its items are then
 * left out of the count rather than counted as missing, so the percentage is right on every backend. With every
 * source served there are twelve.
 */
export interface CompletionSources {
  profile: PatientProfile
  details?: ProfileDetails | null
  health?: HealthProfile | null
  /** The patient's emergency contacts; null where they can't add one now (not served, or delivery is off). */
  emergencyContacts?: readonly EmergencyContact[] | null
}

export interface ProfileCompletion {
  /** Rounded to a whole percent: the items done over the items counted. */
  percent: number
  /** How many items were counted (twelve with every source served). */
  counted: number
  done: CompletionItem[]
  missing: CompletionItem[]
}

const filled = (value: string | null | undefined) => typeof value === 'string' && value.trim() !== ''

/** Whether each item is done, or null when its source is not there to say. */
function status(item: CompletionKey, { profile, details, health, emergencyContacts }: CompletionSources): boolean | null {
  switch (item) {
    // Verified where Identity says so (hid-system 0094 sends emailVerified: an account migrated from hid-1.0 can hold an
    // email never confirmed there). Without the key, an email on file is one a code sent to it confirmed (sign-up, or a
    // change on the profile).
    case 'email': return profile.email === undefined ? null
      : filled(profile.email) && (typeof profile.emailVerified === 'boolean' ? profile.emailVerified : true)
    case 'phone': return profile.phone === undefined ? null : filled(profile.phone)
    case 'gender': return filled(profile.gender)
    case 'dateOfBirth': return filled(profile.dateOfBirth)
    case 'state': return filled(profile.state)
    case 'photo': return typeof profile.hasPhoto === 'boolean' ? profile.hasPhoto : null
    case 'hospital': return details ? filled(details.hospitalCurrentlyUsing) : null
    case 'hmo': return details ? filled(details.hmoName) : null
    // What the patient saved; values carried over from hid-1.0 only start the form.
    case 'bloodGroup': return health ? health.bloodGroup !== null : null
    case 'genotype': return health ? health.genotype !== null : null
    case 'nin': return ninVerifiedOf(profile)
    case 'emergencyContact': return emergencyContacts ? emergencyContacts.length > 0 : null
  }
}

export function profileCompletion(sources: CompletionSources): ProfileCompletion {
  const done: CompletionItem[] = []
  const missing: CompletionItem[] = []
  for (const item of COMPLETION_ITEMS) {
    const known = status(item.key, sources)
    if (known === true) done.push(item)
    else if (known === false) missing.push(item)
  }
  const counted = done.length + missing.length
  return { percent: counted === 0 ? 0 : Math.round((done.length / counted) * 100), counted, done, missing }
}

/** The completion is shown once Identity serves the profile's parity fields (hid-system 0094); before it, not at all. */
export const completionServed = (profile: Pick<PatientProfile, 'hasPhoto'>): boolean => typeof profile.hasPhoto === 'boolean'
