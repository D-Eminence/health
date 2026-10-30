import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { ArrowLeft, ArrowRight, Hospital, LogOut } from 'lucide-react'
import { Alert, Badge, Button, IconChip } from '../../kasuwa/ui'
import { useStaff } from '../../staff/App'
import { roleLabels } from '../../staff/staffAccess'
import { usesNovuBackend } from '../../backendContract'
import type { FacilityChoiceReason } from '../../staff/facilitySelection'

/** Why the question is asked: as Identity reports the selection, 'lost' mid-session, or 'switch' from the account menu. */
export type WorkspaceQuestion = FacilityChoiceReason | 'lost' | 'switch'

// Today's words for each reason (staff/App.tsx FacilityChoice), so the blue question says what today's says.
const WHY: Record<WorkspaceQuestion, string> = {
  reselect: 'The facility you chose for this sign-in is no longer available to you.',
  unchosen: 'You work at more than one facility.',
  unconfirmed: 'The facility for this sign-in is not confirmed.',
  lost: 'The facility you were working at is no longer available to you. The page you had open was closed, along with any patient record, and anything not yet saved there was not sent.',
  switch: 'Switching moves you to that facility’s workspace.',
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
  const { state, selectFacility, signOut, activePatient } = useStaff()
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [signOutError, setSignOutError] = useState('')
  useLayoutEffect(() => { heading.current?.focus() }, [])
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
    <section className="mx-auto flex w-full max-w-xl flex-col gap-6 py-4" aria-labelledby="hid-ehr-blue-chooser-title">
      <div>
        <p className="m-0 text-overline text-ink-3">Health ID · Hospital EHR</p>
        <h1 id="hid-ehr-blue-chooser-title" ref={heading} tabIndex={-1} className="m-0 mt-1 text-title-1 text-ink outline-none" aria-describedby="hid-ehr-blue-chooser-why">
          {reason === 'switch' ? 'Switch facility' : 'Where are you working today?'}
        </h1>
        <p id="hid-ehr-blue-chooser-why" className="m-0 mt-1.5 text-sm text-ink-2">
          {WHY[reason]} Patients, records and requests are those of the facility you choose.
          {activePatient && reason === 'switch' ? ' The open patient record will close.' : ''}
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 rounded-2xl bg-tray p-1.5">
        {actor.facilities.map(facility => {
          const roles = (usesNovuBackend() ? roleLabels(facility.roles) : facility.roles.join(', ')) || 'Staff'
          const here = facility.id === current
          return (
            <li key={facility.id} className="flex items-center gap-3 rounded-xl bg-surface p-4 ring-1 ring-line">
              <IconChip icon={Hospital} tone={here ? 'success' : 'brand'} />
              <div className="min-w-0 flex-1">
                <h2 className="m-0 truncate text-title-3 text-ink">{facility.name}</h2>
                <p className="m-0 mt-0.5 text-[13px] text-ink-3 capitalize">{roles}</p>
              </div>
              {here ? <Badge tone="success" size="sm">You’re here</Badge> : (
                <Button variant="primary" size="sm" iconRight={ArrowRight} loading={busy === facility.id} disabled={busy !== null && busy !== facility.id}
                  aria-label={`Work at ${facility.name}`} onClick={() => void choose(facility.id, facility.name)}>
                  {busy === facility.id ? 'Opening…' : 'Work here'}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {error ? <Alert intent="error" title="That facility couldn’t be opened">{error}</Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {reason === 'switch' ? <Button icon={ArrowLeft} onClick={() => navigate('/provider')}>Back to Home</Button> : <span />}
        <Button variant="ghost" icon={LogOut} onClick={() => void leave()}>Sign out</Button>
      </div>
      {signOutError ? <Alert intent="error" title="Couldn’t sign out">{signOutError}</Alert> : null}
    </section>
  )
}

/** The account menu's Switch facility, as a page of the frame. */
export function ChooseWorkspacePage() {
  return <ChooseWorkspace reason="switch" />
}
