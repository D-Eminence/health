import { useCallback, useEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { staffApi, type FacilityProfileRead, type FacilityProfileValues } from '../../staff/api'

/**
 * The facility's details for Facility setup (hid-system 0114, docs/INTERFACE_CONTRACT.md section 43.4): read once as the wizard
 * opens, shown and changed on its Facility step, listed on its Review step. Kept in the wizard's state only; Identity
 * holds the saved copy.
 *
 * - 'ready': the read answered (`read.profile` is null until the details are first given).
 * - 'kept': Identity keeps this facility's details itself (a governed or legacy facility, a sealed demo facility, or
 *   a backend before 0114, which answers 404): nothing can be changed here.
 * - 'denied': this person may not change the facility's details (403 PERMISSION_DENIED; only the facility
 *   administrator can).
 * - 'failed': the read failed for a fault, and can be tried again.
 *
 * `refusedSave` on 'kept' and 'denied': Identity refused a save, so what was typed is not saved; the step says so and
 * does not go on by itself.
 */
export type ProfileState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly read: FacilityProfileRead }
  | { readonly status: 'kept'; readonly refusedSave?: boolean }
  | { readonly status: 'denied'; readonly refusedSave?: boolean }
  | { readonly status: 'failed' }

export type SaveOutcome = 'saved' | 'conflict' | 'kept' | 'denied' | { readonly error: string }

const KEPT_CODES: ReadonlySet<string> = new Set(['STAFF_MANAGEMENT_NOT_AVAILABLE', 'FACILITY_PROFILE_SEALED'])

/** Why nothing can be changed here, or null for any other answer. */
function refusal(reason: unknown): 'kept' | 'denied' | null {
  if (!isHidApiError(reason)) return null
  if (reason.code === 'PERMISSION_DENIED') return 'denied'
  return reason.status === 404 || KEPT_CODES.has(reason.code) ? 'kept' : null
}

/** The words for a save Identity refused, by its code (contract section 43.4), plain. */
export function saveRefusalText(reason: unknown): string {
  const code = isHidApiError(reason) ? reason.code : ''
  if (code === 'VALIDATION_FAILED' || code === 'FACILITY_PROFILE_INVALID') return 'Check the facility details and try again.'
  if (code === 'IDEMPOTENCY_KEY_REUSED') return 'These details changed while they were being saved. Save them again.'
  return 'We couldn’t save the facility details just now. Try again in a moment.'
}

/** `facilityId` undefined (no working facility: the page refuses) reads nothing. */
export function useFacilityProfile(facilityId: string | undefined) {
  const [state, setState] = useState<ProfileState>({ status: 'loading' })
  const [round, setRound] = useState(0)
  // Someone else saved first (412): their details were read again (the step keeps what was typed and lists theirs
  // beside it) until the next save.
  const [conflict, setConflict] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])
  useEffect(() => {
    if (!facilityId) return
    let active = true
    setState({ status: 'loading' })
    staffApi.facilityProfile(facilityId).then(
      read => { if (active) setState({ status: 'ready', read }) },
      (reason: unknown) => { if (active) setState({ status: refusal(reason) ?? 'failed' }) })
    return () => { active = false }
  }, [facilityId, round])

  const reload = useCallback(() => setRound(value => value + 1), [])

  /**
   * Saves the details at the version last read, with this save's Idempotency-Key. Someone else's save first (412) reads
   * their details and version again without touching the form, so what was typed stays and the next save is made at
   * their version.
   */
  const save = useCallback(async (values: FacilityProfileValues, idempotencyKey: string): Promise<SaveOutcome> => {
    if (state.status !== 'ready' || !facilityId) return 'kept'
    const read = state.read
    try {
      const saved = await staffApi.saveFacilityProfile(facilityId, values, read.version, idempotencyKey)
      if (!live.current) return 'saved'
      setConflict(false)
      const profile = read.profile
      setState({ status: 'ready', read: { ...read, version: saved.version, profile: {
        ...values,
        source: profile?.source ?? 'facility_administrator',
        submitterRole: profile?.submitterRole ?? null,
        submitterPhoneOnRecord: profile?.submitterPhoneOnRecord ?? false,
        updatedAt: new Date().toISOString(),
        version: saved.version,
      } } })
      return 'saved'
    } catch (reason) {
      if (isHidApiError(reason) && (reason.status === 412 || reason.code === 'VERSION_CONFLICT')) {
        try {
          const theirs = await staffApi.facilityProfile(facilityId)
          if (live.current) { setState({ status: 'ready', read: theirs }); setConflict(true) }
          return 'conflict'
        } catch (readReason) {
          const refused = refusal(readReason)
          if (refused) { if (live.current) setState({ status: refused, refusedSave: true }); return refused }
          return { error: saveRefusalText(readReason) }
        }
      }
      const refused = refusal(reason)
      if (refused) { if (live.current) setState({ status: refused, refusedSave: true }); return refused }
      return { error: saveRefusalText(reason) }
    }
  }, [facilityId, state])

  return { state, conflict, reload, save }
}
export type FacilityProfileHandle = ReturnType<typeof useFacilityProfile>
