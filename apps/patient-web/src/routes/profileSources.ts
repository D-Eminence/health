import { useMemo } from 'react'
import { isHidApiError } from '@hid/http'
import type { PatientApi, PatientProfile } from '../api'
import type { HealthProfile, ProfileDetails } from '../profileParity'
import { useSession } from '../session'
import { usePatientResource } from './usePatientResource'
import { contactsToCount, readEmergencyContacts, type ContactsView } from './AccountSafety'
import { completionServed, profileCompletion, type ProfileCompletion } from './profileCompletion'

/** A read a backend may not serve: its 404 is null, "not offered", and the section is not shown. */
export function servedOrNull<T>(read: (signal?: AbortSignal) => Promise<T>) {
  return async (signal?: AbortSignal): Promise<T | null> => {
    try { return await read(signal) } catch (caught) {
      if (isHidApiError(caught) && caught.status === 404) return null
      throw caught
    }
  }
}

const nothing = async (): Promise<null> => null

function loaders(api: PatientApi) {
  return {
    details: servedOrNull(api.profileDetails),
    health: servedOrNull(api.healthProfile),
    contacts: readEmergencyContacts(api),
  }
}

/**
 * The profile and the parity reads its completion counts (hid-1.0 parity B3), each in memory for the account under
 * its own name, so the profile and the overview share them. The emergency contacts are read only once Identity serves
 * the completion; before it, nothing more than the profile is asked of it.
 */
export function useProfileSources() {
  const { api } = useSession()
  const load = useMemo(() => loaders(api), [api])
  // First, so it is the first read a page sends.
  const profile = usePatientResource(api.profile)
  const details = usePatientResource<ProfileDetails | null>(load.details, 'profile-details')
  const health = usePatientResource<HealthProfile | null>(load.health, 'health-profile')
  const counted = profile.data !== null && !profile.error && completionServed(profile.data)
  const contacts = usePatientResource<ContactsView | null>(counted ? load.contacts : nothing, counted ? 'emergency-contacts' : 'emergency-contacts-unread')
  return { profile, details, health, contacts }
}

/**
 * The completion once every source it counts has answered (a source that failed is left out of the count), or null
 * while Identity does not serve it or one is still being read for the first time.
 */
export function completionOf(profile: PatientProfile | null, sources: {
  details: { data: ProfileDetails | null; loading: boolean; error: string | null }
  health: { data: HealthProfile | null; loading: boolean; error: string | null }
  contacts: { data: ContactsView | null; loading: boolean; error: string | null }
}): ProfileCompletion | null {
  if (!profile || !completionServed(profile)) return null
  // The contacts are asked for only once the profile is in, and always answer something: until then they are pending.
  const pending = [sources.details, sources.health].some(source => source.loading && source.data === null && !source.error)
    || (sources.contacts.data === null && !sources.contacts.error)
  if (pending) return null
  return profileCompletion({
    profile,
    details: sources.details.error ? null : sources.details.data,
    health: sources.health.error ? null : sources.health.data,
    emergencyContacts: sources.contacts.error ? null : contactsToCount(sources.contacts.data),
  })
}
