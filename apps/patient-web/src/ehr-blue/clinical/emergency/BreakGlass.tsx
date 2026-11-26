import { HEALTH_ID_PREFIX, normalizeHealthIdInput } from '@hid/contracts'
import { Siren } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Field, FilterTabs, Input, Textarea } from '../../../kasuwa/ui'
import { FormActions } from '../../../kasuwa/parts'
import { usesNovuBackend } from '../../../backendContract'
import { isAllowedPatientLookup, staffApi } from '../../../staff/api'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import { selfServiceReview } from '../../../staff/staffAccess'
import { patientFacts } from '../parts/PatientHeader'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { offeredHealthId, dropOfferedHealthId, roleMay } from '../consent/access'
import { isHidApiError } from '@hid/http'
import type { PatientSearchAnswer, PatientSearchCard } from '../../../staff/patientSearch'
import { SEARCH_EXPIRED } from '../patients/searchWords'
import { CHOOSE_PATIENT, EmergencyNameSearch } from './EmergencySearch'
import { rememberEmergencyCard } from '../../departments/emergency/emergencyArrival'
import {
  COMMAND_FAILED, EMERGENCY_ACCESS, EMERGENCY_MINUTES, HID_FORMAT, NOTICE_SHORT, NOTICE_WHEN, NOT_GRANTED, REASON_MAX, REASON_MIN, REASON_TOO_SHORT,
  actionUnavailable, breakGlassRefusal, emergencyNotice, healthIdProblem,
} from './access'
import { PlainError, plainErrorText } from '@hid/http'

const FIELDS = ['hid', 'reason', 'ack'] as const
/** Found by name, the reason comes first (the search needs it), then the patient confirmed from the search. */
const NAME_FIELDS = ['reason', 'patient', 'ack'] as const
type FieldKey = (typeof FIELDS)[number] | (typeof NAME_FIELDS)[number]
type FindBy = 'hid' | 'name'
type Problems = Partial<Record<FieldKey, string>>

/**
 * The acknowledgement, naming the expiry today's break-glass request asks for. It claims only what is true for every
 * grant: it is recorded, the patient can see it in Who has access, and it ends by itself. (A message to the patient is
 * sent only where those alerts are switched on, so it is not promised here.)
 */
export const REASON_HINT = 'What is happening, and why care can’t wait. It’s kept with the record of this opening.'
/** Found by name, the reason goes first: the emergency search is sent with it, and so is the opening. */
export const REASON_HINT_SEARCH = 'What is happening, and why care can’t wait. It’s sent with the search, then kept with the record of this opening.'

export const ACKNOWLEDGE = `I understand this is recorded with my name and my reason, the patient can see it, and access ends by itself after ${EMERGENCY_MINUTES} minutes.`

/** The open emergency patient, with the way back to their emergency summary. */
export function CurrentEmergency() {
  const { activePatient } = useClinical()
  const href = useWorkspaceHref()
  if (activePatient?.purpose !== 'emergency') return null
  return (
    <Alert intent="warning" icon={Siren} live={false} title={`${patientFacts(activePatient).name} is open with emergency access`}
      action={<Button size="sm" to={href('summary')}>Open summary</Button>} />
  )
}

/**
 * Emergency access: the Health ID, one reason (the request carries one) and the acknowledgement. It runs today's flow:
 * break-glass, then, once the session that asked is ready, an emergency lookup; the record opens only when that lookup
 * allows it and the session still accepts it, and then the emergency summary shows.
 */
export function BreakGlassCard() {
  const { facility, permissions, setActivePatient } = useClinical()
  const navigate = useNavigate()
  const href = useWorkspaceHref()
  const id = useId()
  // A Health ID handed over from Find a patient, if any, read once; otherwise the field starts at HID-, as today's does.
  const [hid, setHid] = useState(() => offeredHealthId(facility?.id, setActivePatient) || HEALTH_ID_PREFIX)
  useEffect(() => { dropOfferedHealthId() }, [])
  // The emergency search (0132, ID-3b) for a patient without their Health ID card, to staff who may search in an emergency.
  const searches = roleMay('identity.patientEmergencySearch', 'POST', permissions)
  const [findBy, setFindBy] = useState<FindBy>('hid')
  // The emergency search's answer, and its one card once the clinician confirmed it is the patient in front of them.
  const [searchAnswer, setSearchAnswer] = useState<PatientSearchAnswer | null>(null)
  const [chosen, setChosen] = useState<PatientSearchCard | null>(null)
  // Found by name, Open is offered only for an answer of exactly one card (never a choice between several), and is
  // enabled only once that card is confirmed.
  const singleCard = findBy === 'name' && searchAnswer?.patients.length === 1
  const offersOpen = findBy === 'hid' || singleCard
  const awaitingConfirm = findBy === 'name' && chosen === null
  const fields: readonly FieldKey[] = findBy === 'name' ? NAME_FIELDS : FIELDS
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [problems, setProblems] = useState<Problems>({})
  // A problem refused from Enter in its own field cannot move focus to say why: it is an alert there, new each time.
  const [alerted, setAlerted] = useState<{ field: FieldKey; key: number } | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ field: FieldKey; key: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const alerts = useRef(0)
  const normalized = normalizeHealthIdInput(hid)
  const administrator = usesNovuBackend() && permissions.includes('workforce.manage') ? selfServiceReview(facility) : null
  const unavailable = actionUnavailable(EMERGENCY_ACCESS, permissions, administrator)
  const unavailableId = `${id}-unavailable`
  const controlId = (field: FieldKey) => `${id}-${field}`

  useLayoutEffect(() => {
    if (focusRequest) document.getElementById(`${id}-${focusRequest.field}`)?.focus()
  }, [focusRequest, id])

  const changed = (field: FieldKey) => {
    setProblems(current => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
    setAlerted(current => current?.field === field ? null : current)
  }

  const errorFor = (field: FieldKey): ReactNode => {
    const message = problems[field]
    if (!message) return undefined
    return alerted?.field === field ? <span key={alerted.key} role="alert">{message}</span> : message
  }

  function check(): Problems {
    const found: Problems = {}
    if (findBy === 'hid') {
      const hidProblem = healthIdProblem(normalized)
      if (hidProblem) found.hid = hidProblem
    }
    if (reason.trim().length < REASON_MIN) found.reason = REASON_TOO_SHORT
    // A card's expiry is left to Identity (break-glass answers 404 for an expired matchRef): its time is the server's,
    // and a device clock running fast must never block emergency access.
    if (findBy === 'name' && !chosen) found.patient = CHOOSE_PATIENT
    if (!ack) found.ack = 'Tick the box to go on.'
    return found
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The button stays focusable while the request runs; a second press does nothing.
    if (sending.current || !facility || unavailable !== null) return
    setError('')
    const found = check()
    setProblems(found)
    const first = fields.find(field => found[field])
    if (first) {
      const within = document.activeElement === document.getElementById(controlId(first))
      if (within) setAlerted({ field: first, key: ++alerts.current })
      else {
        setAlerted(null)
        setFocusRequest({ field: first, key: ++alerts.current })
      }
      return
    }
    setAlerted(null)
    sending.current = true
    setBusy(true)
    // The record opens only while the session that asked for emergency access is ready: it waits while that session
    // is checked, and never opens once it ended.
    const sentIn = staffSessionGeneration()
    if (findBy === 'name' && chosen) {
      await openFromCard(chosen, sentIn)
      return
    }
    try {
      try {
        await staffApi.breakGlass(facility.id, normalized, reason.trim())
      } catch (caught) {
        const known = breakGlassRefusal(caught, facility.name)
        if (known) throw new PlainError(known)
        throw caught
      }
      await untilStaffSessionReady(sentIn)
      const lookup = await staffApi.lookupPatient(facility.id, normalized, 'emergency')
      if (!isAllowedPatientLookup(lookup)) {
        setActivePatient(null)
        throw new PlainError(NOT_GRANTED)
      }
      // A lookup answered after the session or facility changed opens nothing.
      if (setActivePatient({ hid: normalized, lookup, purpose: 'emergency' })) navigate(href.to('emergency', 'summary'))
    } catch (caught) {
      setError(plainErrorText(caught, COMMAND_FAILED, { audience: 'facility' }))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  /**
   * Break-glass for the card chosen from the emergency search (ID-5): the card's matchRef names the patient, with the
   * reason. The card carries no Health ID, so the record opens from break-glass's own answer (its patient id, grant and
   * end) and the card's name, sex and date of birth, once the session that asked is ready; every read after it is
   * checked by the server, and the Health ID shows as its last four.
   */
  async function openFromCard(card: PatientSearchCard, sentIn: number) {
    if (!facility) return
    try {
      let grant
      try {
        grant = await staffApi.breakGlassByMatchRef(facility.id, card.matchRef, reason.trim())
      } catch (caught) {
        const known = breakGlassRefusal(caught, facility.name)
        if (known) throw new PlainError(known)
        // A card's matchRef that no longer resolves (expired, or the patient is no longer active) answers 404: the old
        // cards go with it, so only a new search shows any.
        if (isHidApiError(caught) && caught.status === 404) {
          setChosen(null)
          setSearchAnswer(null)
          throw new PlainError(SEARCH_EXPIRED)
        }
        throw caught
      }
      if (grant.status !== 'active' || !grant.patientId) throw new PlainError(COMMAND_FAILED)
      await untilStaffSessionReady(sentIn)
      const opened = setActivePatient({
        hid: '',
        healthIdLast4: card.healthIdLast4,
        purpose: 'emergency',
        lookup: {
          authorization: { decision: 'allow', expiresAt: grant.expiresAt, consentGrantId: grant.consentGrantId, breakGlass: true, scope: 'read_records' },
          patient: { patientId: grant.patientId, hid: '', fullName: card.fullName, dateOfBirth: card.dateOfBirth ?? undefined, gender: card.sex ?? undefined },
        },
      })
      // An answer after the session or facility changed opens nothing. The card is kept, in memory only, so the summary can
      // offer to put the patient on the emergency board (ED-1, Q-ED-3 A).
      if (opened) {
        rememberEmergencyCard(facility.id, grant.patientId, card.matchRef)
        navigate(href.to('emergency', 'summary'))
      }
    } catch (caught) {
      setError(plainErrorText(caught, COMMAND_FAILED, { audience: 'facility' }))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  function changeFindBy(next: FindBy) {
    if (busy || next === findBy) return
    setFindBy(next)
    setProblems({})
    setAlerted(null)
    setError('')
    setChosen(null)
    setSearchAnswer(null)
  }

  const ackError = errorFor('ack')
  const ackErrorId = `${id}-ack-error`
  const describe = (field: FieldKey, hint: boolean) => problems[field] ? `${controlId(field)}-error` : hint ? `${controlId(field)}-hint` : undefined

  return (
    <Card>
      <form noValidate className="flex flex-col gap-5 p-5" onSubmit={event => void submit(event)}>
        {/* One line when care can't wait (QA P1-16); the whole notice, as today's (Patients.tsx:243), under More details. */}
        <Alert intent="warning" live={false} title={NOTICE_WHEN}>
          {NOTICE_SHORT}
          <details className="mt-1.5">
            <summary className="cursor-pointer font-medium underline underline-offset-2">More details</summary>
            <p className="m-0 mt-1.5">{emergencyNotice(usesNovuBackend())}</p>
          </details>
        </Alert>
        {searches ? <FilterTabs<FindBy> label="Find the patient by" value={findBy} onChange={changeFindBy} options={[
          { value: 'hid', label: 'Health ID' }, { value: 'name', label: 'Name and date of birth' }]} /> : null}
        {findBy === 'hid' ? <Field label="Health ID" htmlFor={controlId('hid')} hint={HID_FORMAT} hintId={`${controlId('hid')}-hint`} error={errorFor('hid')} errorId={`${controlId('hid')}-error`}>
          <Input id={controlId('hid')} required autoComplete="off" spellCheck={false} value={hid} placeholder="HID-ADA2345"
            className="font-medium tracking-[.06em] uppercase" aria-invalid={problems.hid ? true : undefined} aria-describedby={describe('hid', true)}
            onChange={event => { setHid(normalizeHealthIdInput(event.target.value)); changed('hid') }} />
        </Field> : null}
        <Field label="Why do you need emergency access?" htmlFor={controlId('reason')} hint={findBy === 'name' ? REASON_HINT_SEARCH : REASON_HINT}
          hintId={`${controlId('reason')}-hint`} error={errorFor('reason')} errorId={`${controlId('reason')}-error`}>
          <Textarea id={controlId('reason')} required rows={3} maxLength={REASON_MAX} value={reason}
            aria-invalid={problems.reason ? true : undefined} aria-describedby={describe('reason', true)}
            onChange={event => { setReason(event.target.value); changed('reason') }} />
        </Field>
        {findBy === 'name' ? <EmergencyNameSearch idBase={id} facilityId={facility?.id} reason={reason} chosen={chosen} problem={errorFor('patient')}
          answer={searchAnswer} onAnswer={setSearchAnswer}
          onChoose={card => { setChosen(card); changed('patient') }}
          onReasonMissing={() => {
            setProblems(current => ({ ...current, reason: REASON_TOO_SHORT }))
            setAlerted(null)
            setFocusRequest({ field: 'reason', key: ++alerts.current })
          }} /> : null}
        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
            <input id={controlId('ack')} type="checkbox" required checked={ack} className="mt-0.5 size-4 shrink-0 accent-brand-fill"
              aria-invalid={problems.ack ? true : undefined} aria-describedby={ackError ? ackErrorId : undefined}
              onChange={event => { setAck(event.target.checked); changed('ack') }} />
            <span>{ACKNOWLEDGE}</span>
          </label>
          {ackError ? <p id={ackErrorId} className="m-0 text-xs font-medium text-danger-ink">{ackError}</p> : null}
        </div>
        {error ? <Alert intent="error" title="Couldn’t open emergency access">{error}</Alert> : null}
        {unavailable ? <p id={unavailableId} className="m-0 text-[13px] text-ink-3">{unavailable}</p> : null}
        {offersOpen ? <FormActions sticky={false}>
          {/* Busy, it stays focusable (aria-disabled, not disabled): focus is not lost while the request runs, and a second
              press sends nothing (submit returns while one is on its way). Found by name, it is off until the one card is
              confirmed as the patient in front of the clinician. */}
          <Button type="submit" variant="destructive" icon={Siren} disabled={!facility || unavailable !== null || awaitingConfirm}
            aria-disabled={busy || undefined}
            aria-describedby={unavailable ? unavailableId : undefined}>{busy ? 'Opening…' : 'Open emergency access'}</Button>
        </FormActions> : null}
      </form>
    </Card>
  )
}
