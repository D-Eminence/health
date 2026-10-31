import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton } from '@hid/ui/ehr'
import { useStaff } from '../../staff/App'
import { roleLabels } from '../../staff/staffAccess'
import { usesNovuBackend } from '../../backendContract'
import type { FacilityChoiceReason } from '../../staff/facilitySelection'

/** Why the question is asked: as Identity reports the selection, 'lost' mid-session, or 'switch' from the account menu. */
export type WorkspaceQuestion = FacilityChoiceReason | 'lost' | 'switch'

// Today's words for each reason (staff/App.tsx FacilityChoice), so the blue question says what today's says. Switch
// facility says only the design's line.
const WHY: Record<Exclude<WorkspaceQuestion, 'switch'>, string> = {
  reselect: 'The facility you chose for this sign-in is no longer available to you.',
  unchosen: 'You work at more than one facility.',
  unconfirmed: 'The facility for this sign-in is not confirmed.',
  lost: 'The facility you were working at is no longer available to you. The page you had open was closed, along with any patient record, and anything not yet saved there was not sent.',
}

/** A choice Identity refused, in words the person can act on (today's facilityRefusal). */
function refusal(caught: unknown, facility: string): string {
  if (isHidApiError(caught) && caught.code === 'FACILITY_ACCESS_DENIED') return `You are no longer active at ${facility}. Choose another facility.`
  return caught instanceof Error ? caught.message : 'Facility could not be selected.'
}

/**
 * Choose your workspace (design: screens/admin/institutions.png). Live: each choice is today's facility switch
 * (POST /auth/facility through useStaff), with today's refusals. Nothing is preselected and nothing switches until a
 * facility's button is pressed. Asked before any page opens (`reason`), or opened from the account menu to switch.
 */
export function ChooseWorkspace({ reason, onChosen }: { readonly reason: WorkspaceQuestion; readonly onChosen?: () => void }) {
  const { state, selectFacility, signOut, activePatient, lock } = useStaff()
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [signOutError, setSignOutError] = useState('')
  useLayoutEffect(() => { heading.current?.focus() }, [])
  // Today's ProviderTitle (staff/App.tsx) names this address "Page not found": today's portal has no such page. Switch
  // facility is the blue EHR's own page, so it names the tab as the frame names its pages, again after the lock screen.
  // The question asked before any page opens keeps today's "Where are you working?".
  useEffect(() => {
    if (reason === 'switch' && lock === null) document.title = 'Choose workspace · Health ID EHR'
  }, [reason, lock])
  if (state.status !== 'ready') return null
  const { actor } = state.session
  const current = reason === 'switch' ? actor.facility?.id : undefined

  async function choose(id: string, name: string) {
    if (busy) return
    setError('')
    setBusy(id)
    try {
      if (await selectFacility(id)) {
        onChosen?.()
        if (reason === 'switch') navigate('/provider')
      }
    } catch (caught) { setError(refusal(caught, name)) }
    finally { setBusy(null) }
  }

  async function leave() {
    setSignOutError('')
    try { await signOut() }
    catch (caught) { setSignOutError(caught instanceof Error ? caught.message : 'Sign-out could not be completed.') }
  }

  return (
    <section className="hid-ehr-blue-chooser" aria-labelledby="hid-ehr-blue-chooser-title">
      <p className="hid-ehr-blue-eyebrow">Health ID — Hospital EHR</p>
      <h1 id="hid-ehr-blue-chooser-title" ref={heading} tabIndex={-1} className="hid-ehr-page-title" aria-describedby="hid-ehr-blue-chooser-why">
        Choose your workspace
      </h1>
      <p id="hid-ehr-blue-chooser-why" className="hid-ehr-blue-chooser-why">
        {reason === 'switch' ? 'Select one of your facility memberships.'
          : `${WHY[reason]} Select one of your facility memberships. Patient access, records and requests use the facility you choose.`}
        {activePatient && reason === 'switch' ? ' The open patient record will close.' : ''}
      </p>
      <ul className="hid-ehr-blue-chooser-list">
        {actor.facilities.map(facility => {
          const roles = (usesNovuBackend() ? roleLabels(facility.roles) : facility.roles.join(', ')) || 'Staff'
          return (
            <li key={facility.id} className="hid-ehr-card hid-ehr-blue-facility-card">
              <h2 className="hid-ehr-card-title">{facility.name}</h2>
              <p className="hid-ehr-blue-muted">{roles} · active</p>
              {facility.id === current ? <EhrBadge>Current workspace</EhrBadge> : (
                <EhrButton busy={busy === facility.id} disabled={busy !== null && busy !== facility.id}
                  aria-label={`Work at ${facility.name}`} onClick={() => choose(facility.id, facility.name)}>
                  {busy === facility.id ? 'Opening…' : 'Work here'}
                </EhrButton>
              )}
            </li>
          )
        })}
      </ul>
      {error ? <p role="alert" className="hid-ehr-error">{error}</p> : null}
      <div className="hid-ehr-actions">
        {reason === 'switch' ? <EhrButton variant="secondary" onClick={() => navigate('/provider')}>Back to Home</EhrButton> : null}
        <EhrButton variant="secondary" onClick={leave}>Sign out</EhrButton>
      </div>
      {signOutError ? <p role="alert" className="hid-ehr-error">{signOutError}</p> : null}
    </section>
  )
}

/** The account menu's Switch facility. EhrBlueApp draws it as a page of its own, outside the frame, as the design does. */
export function ChooseWorkspacePage() {
  return <ChooseWorkspace reason="switch" />
}
