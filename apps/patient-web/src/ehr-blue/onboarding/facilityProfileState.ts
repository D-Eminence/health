import { useCallback, useEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { staffApi, type FacilityProfileRead, type FacilityProfileValues } from '../../staff/api'

/**
 * The facility's details for Facility setup (hid-system 0114, collect-fields-contract.md §4): read once as the wizard
 * opens, shown and changed on its Facility step, listed on its Review step. Kept in the wizard's state only; Identity
 * holds the saved copy.
 *
 * - 'ready': the read answered (`read.profile` is null until the details are first given).
 * - 'kept': Identity keeps this facility's details itself (a governed or legacy facility, a sealed demo facility, or
 *   a backend before 0114, which answers 404): nothing can be changed here.
 * - 'failed': the read failed for a fault, and can be tried again.
 */
export type ProfileState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly read: FacilityProfileRead }
  | { readonly status: 'kept' }
  | { readonly status: 'failed' }

export type SaveOutcome = 'saved' | 'conflict' | 'kept' | { readonly error: string }

const KEPT_CODES: ReadonlySet<string> = new Set(['STAFF_MANAGEMENT_NOT_AVAILABLE', 'FACILITY_PROFILE_SEALED', 'PERMISSION_DENIED'])

function kept(reason: unknown): boolean {
  return isHidApiError(reason) && (reason.status === 404 || KEPT_CODES.has(reason.code))
}

/** The words for a save Identity refused, by its code (contract §4), plain. */
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
  // Someone else saved first (412): the details were read again, and the step says so until the next save.
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
      (reason: unknown) => { if (active) setState({ status: kept(reason) ? 'kept' : 'failed' }) })
    return () => { active = false }
  }, [facilityId, round])

  const reload = useCallback(() => setRound(value => value + 1), [])

  /**
   * Saves the details at the version last read, with this save's Idempotency-Key. Someone else's save first (412) reads
   * the details again, so the next save starts from theirs.
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
        if (live.current) setConflict(true)
        reload()
        return 'conflict'
      }
      if (kept(reason)) { if (live.current) setState({ status: 'kept' }); return 'kept' }
      return { error: saveRefusalText(reason) }
    }
  }, [facilityId, state, reload])

  return { state, conflict, reload, save }
}
export type FacilityProfileHandle = ReturnType<typeof useFacilityProfile>
