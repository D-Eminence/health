import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import {
  edBoardApi, staffApi, unknownPatientApi, type EdArrivalInput, type EdArrivalMode, type EdArrivalPatient, type EdArrived,
  type UnknownPatientInput, type UnknownPatientMade, type UnknownPatientReason,
} from '../../../staff/api'
import { ninStatusLabel, type PatientSearchCard } from '../../../staff/patientSearch'
import { useFocusById } from '../../../staff/focus'
import { noCardText, searchRefusal } from '../../clinical/patients/searchWords'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { birthDateText, countText } from '../parts/format'
import { NO_TRIAGE_LEVEL, TRIAGE_HINT, TRIAGE_LEVELS, triageText } from '../parts/triageLevels'
import { EMPTY_SEARCH, SEARCH_EMPTY, SEARCH_HINT, healthIdEnding, searchKeys, sexText, type SearchValues } from '../waiting/waitingRules'
import {
  ARRIVAL_MODES, ARRIVAL_MODE_WORDS, BASE, COMPLAINT_MAX, EYEBROW, NOT_AVAILABLE, UNKNOWN_HINT, UNKNOWN_REASONS, UNKNOWN_REASON_WORDS,
  UNKNOWN_SEXES, arrivalMoment, canArrive, canSearch, canTriage, cardName, complaintProblem, edBoardServed, learnFrom, refusalWords,
  unknownRefusal,
} from './edRules'
import { useIdempotencyKeys } from './hooks'
import { PrintHeader } from '../../frame/PrintHeader'
import { printPaper, receiptFor, type PaperPrint } from '../../../print/printPaper'
// Prints a [data-receipt-print] paper alone, black on white, on a slip (as the new Health ID slip in Pharmacy).
import '../commerce/commerce.css'

type Who = 'search' | 'unknown'
interface Details { readonly mode: EdArrivalMode | ''; readonly time: string; readonly level: string; readonly complaint: string }
const EMPTY_DETAILS: Details = { mode: '', time: '', level: '', complaint: '' }
interface Unknown { readonly gender: UnknownPatientInput['gender'] | ''; readonly age: string; readonly reason: UnknownPatientReason | ''; readonly note: string }
const EMPTY_UNKNOWN: Unknown = { gender: '', age: '', reason: '', note: '' }

const ARRIVAL_INVALID = 'Check how the patient came, the arrival time, the triage level and the complaint.'
/** An unknown patient's wristband slip: its PDF's title names the facility and "Wristband", never the patient. */
const WRISTBAND_PAPER: PaperPrint = { size: 'slip', kind: 'Wristband' }

/**
 * New arrival (ED-1 route 1, in place of the sample's "New board entry"): the patient from a staff search card (its
 * matchRef, in the body), or "Unknown patient" (an ID-7 record made here, then put on the board by its patientId as this
 * facility's own); how they came; the arrival time (Lagos, up to 6 hours ago; left empty, now); and for nurses,
 * clinicians and doctors the triage level and a short presenting complaint. Nothing typed or found goes to storage, the
 * address or router state, and is cleared once the patient is on the board. An unknown patient's Health ID is shown on
 * this page only, for the wristband, from the moment the record is made (ID-7 answers it once): an arrival that then
 * fails does not lose it. Each arrival is a request of its own: "Add another arrival" starts with new Idempotency-Keys,
 * so a second unknown patient with the same answers as the first gets a record and a Health ID of their own.
 */
export function NewArrival({ facilityId }: { readonly facilityId: string }) {
  const navigate = useNavigate()
  const { permissions } = useDeptAccess()
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const [who, setWho] = useState<Who>('search')
  const [chosen, setChosen] = useState<PatientSearchCard | null>(null)
  const [unknown, setUnknown] = useState<Unknown>(EMPTY_UNKNOWN)
  const [made, setMade] = useState<UnknownPatientMade | null>(null)
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Done | null>(null)
  const triages = canTriage(permissions)
  const searches = canSearch(permissions)

  if (!canArrive(permissions)) {
    return (
      <DeptPage eyebrow={EYEBROW} title="New arrival" onBack={() => navigate(BASE)} backLabel="Back to the board">
        <DeptNotice tone="info">Only the front desk, nurses, clinicians and doctors of this facility can add patients to the board.</DeptNotice>
      </DeptPage>
    )
  }

  if (done) {
    return <Arrived done={done} onAnother={() => {
      setDone(null); setChosen(null); setMade(null); setUnknown(EMPTY_UNKNOWN); setDetails(EMPTY_DETAILS)
      // Another arrival is another patient: the keys of this one are dropped, so the same answers (two casualties both
      // "Not known" and "Unconscious") make a second record, never a replay of the first patient's record and Health ID.
      // A retry within one arrival keeps its key, as before.
      keyFor.clear()
      // The button pressed goes with the result: focus starts the new arrival at its first question.
      focus('ed-arrival-who')
    }} />
  }

  function setDetail(next: Partial<Details>) { setDetails(previous => ({ ...previous, ...next })) }

  /** The arrival's own fields, checked here first; the server checks them again. */
  function arrivalInput(): EdArrivalInput | string {
    if (details.mode === '') return 'Choose how the patient came.'
    const input: { -readonly [K in keyof EdArrivalInput]: EdArrivalInput[K] } = { arrivalMode: details.mode }
    if (details.time) {
      const moment = arrivalMoment(details.time)
      if (!moment) return 'Enter the arrival time as hours and minutes, for example 09:05.'
      input.arrivedAt = moment
    }
    if (triages) {
      if (details.level) input.triageLevel = Number(details.level)
      const wrong = complaintProblem(details.complaint)
      if (wrong) return wrong
      if (details.complaint.trim()) input.presentingComplaint = details.complaint.trim()
    }
    return input
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const input = arrivalInput()
    if (typeof input === 'string') { setError(input); focus('ed-arrival-error'); return }
    let patient: EdArrivalPatient
    let wristband: UnknownPatientMade | null = made
    // Where focus goes once the request is over: the result on success, the problem on any refusal (those returned early
    // too), nowhere for a request stopped on purpose. One request: a later one would replace it (useFocusById).
    let focusOn: string | null = 'ed-arrival-error'
    setBusy(true)
    try {
      if (who === 'search') {
        if (!chosen) { setError('Search for the patient, then choose them.'); return }
        patient = { matchRef: chosen.matchRef }
      } else {
        if (!wristband) {
          if (unknown.gender === '' || unknown.reason === '') { setError('Choose the sex and why the patient cannot say who they are.'); return }
          // The board has answered that it is not served (switched off, or an ehr-api before 0168): no record is made
          // for an arrival that cannot be added.
          if (edBoardServed() === false) { setError(NOT_AVAILABLE); return }
          const age = unknown.age.trim()
          if (age && !(/^\d{1,3}$/.test(age) && Number(age) <= 120)) { setError('Enter the estimated age in years, from 0 to 120.'); return }
          const body: UnknownPatientInput = {
            gender: unknown.gender, unknownReason: unknown.reason,
            ...(age ? { estimatedAgeYears: Number(age) } : {}),
            ...(unknown.note.trim() ? { arrivalNote: unknown.note.trim() } : {}),
          }
          try {
            wristband = await unknownPatientApi.create(facilityId, body, keyFor('unknown', body))
            setMade(wristband)
          } catch (caught) {
            if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') { focusOn = null; return }
            setError(unknownRefusal(caught))
            return
          }
        }
        patient = { patientId: wristband.patientId }
      }
      const arrived = await edBoardApi.arrive(facilityId, patient, input, keyFor('arrive', { patient, input }))
      learnFrom()
      // Whether a triage level or complaint went with the arrival: an answer of already_on_board saves neither.
      setDone({ arrived, wristband, levelSent: input.triageLevel !== undefined, complaintSent: input.presentingComplaint !== undefined })
      focusOn = 'ed-arrived-title'
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') { focusOn = null; return }
      learnFrom(caught)
      // A search card no longer usable: back to the search, as the waiting list does.
      if (isHidApiError(caught) && caught.code === 'ED_ARRIVAL_NEEDS_SEARCH') setChosen(null)
      setError(refusalWords(caught, 'The patient could not be added to the board. Try again.', ARRIVAL_INVALID))
    } finally {
      setBusy(false)
      if (focusOn) focus(focusOn)
    }
  }

  return (
    <DeptPage eyebrow={EYEBROW} title="New arrival" description="Add a patient to the emergency board as they arrive."
      onBack={() => navigate(BASE)} backLabel="Back to the board">
      <DeptSection title="Who arrived" headingId="ed-arrival-who">
        <div className="hid-ehr-dept-emergency-choice" role="radiogroup" aria-labelledby="ed-arrival-who">
          <label>
            <input type="radio" name="ed-who" checked={who === 'search'} disabled={made !== null} onChange={() => { setWho('search'); setError('') }} />
            <span>A patient found by search</span>
          </label>
          <label>
            <input type="radio" name="ed-who" checked={who === 'unknown'} onChange={() => { setWho('unknown'); setChosen(null); setError('') }} />
            <span>Unknown patient</span>
          </label>
        </div>
        {who === 'search' ? (
          searches
            ? <ArrivalSearch facilityId={facilityId} chosen={chosen} onChoose={card => { setChosen(card); setError('') }} onPicked={focus} />
            : <DeptNotice tone="info">Your role here does not search for patients. Ask the front desk to find the patient, or choose Unknown patient.</DeptNotice>
        ) : made ? (
          <DeptNotice tone="positive" title={`Unknown patient ${made.label}`}>
            The record is made. Fill in how they came, then select Add to the board.
          </DeptNotice>
        ) : searches ? (
          <UnknownFields value={unknown} onChange={next => setUnknown(previous => ({ ...previous, ...next }))} />
        ) : (
          <DeptNotice tone="info">Your role here can’t make an unknown patient’s record. Ask the front desk.</DeptNotice>
        )}
      </DeptSection>

      {/* Shown as soon as the record is made, not only once the arrival is saved: the record exists even if the arrival
          then fails (the board switched off, no connection), and its full Health ID is not shown anywhere else. */}
      {made ? <Wristband made={made} /> : null}

      <form className="hid-ehr-dept-form" noValidate onSubmit={event => void submit(event)} aria-label="Arrival">
        <DeptSection title="Arrival" headingId="ed-arrival-details">
          <div className="hid-ehr-dept-form-grid">
            <EhrField label="How they came" controlId="ed-arrival-mode">
              <EhrSelect value={details.mode} onChange={event => setDetail({ mode: event.target.value as EdArrivalMode | '' })}>
                <option value="">Choose</option>
                {ARRIVAL_MODES.map(mode => <option key={mode} value={mode}>{ARRIVAL_MODE_WORDS[mode]}</option>)}
              </EhrSelect>
            </EhrField>
            <EhrField label="Arrival time (optional)" controlId="ed-arrival-time" hint="Lagos time, up to 6 hours ago. Leave it empty if they arrived just now.">
              <EhrInput type="time" value={details.time} onChange={event => setDetail({ time: event.target.value })} />
            </EhrField>
            {triages ? (
              <>
                <EhrField label="Triage level (optional)" controlId="ed-arrival-level" hint={TRIAGE_HINT}>
                  <EhrSelect value={details.level} onChange={event => setDetail({ level: event.target.value })}>
                    <option value="">{NO_TRIAGE_LEVEL}</option>
                    {TRIAGE_LEVELS.map(level => <option key={level} value={String(level)}>{triageText(level)}</option>)}
                  </EhrSelect>
                </EhrField>
                <EhrField label="Presenting complaint (optional)" controlId="ed-arrival-complaint" hint="A few words, for example Fall, left leg pain.">
                  <EhrInput value={details.complaint} onChange={event => setDetail({ complaint: event.target.value })} maxLength={COMPLAINT_MAX} autoComplete="off" />
                </EhrField>
              </>
            ) : null}
          </div>
          {error ? <DeptNotice id="ed-arrival-error" tabIndex={-1} role="alert" tone="critical">{error}</DeptNotice> : null}
          <div className="hid-ehr-dept-form-actions">
            <EhrButton type="button" variant="quiet" onClick={() => navigate(BASE)}>Cancel</EhrButton>
            <EhrButton type="submit" busy={busy}>Add to the board</EhrButton>
          </div>
        </DeptSection>
      </form>
    </DeptPage>
  )
}

interface Done {
  readonly arrived: EdArrived
  readonly wristband: UnknownPatientMade | null
  /** A triage level was sent with the arrival. */
  readonly levelSent: boolean
  /** A presenting complaint was sent with the arrival. */
  readonly complaintSent: boolean
}

/** What an answer of already_on_board did not save, naming only what was entered. */
function notSavedTitle(levelSent: boolean, complaintSent: boolean): string | null {
  if (levelSent && complaintSent) return 'The triage level and complaint you entered were not saved'
  if (levelSent) return 'The triage level you entered was not saved'
  if (complaintSent) return 'The complaint you entered was not saved'
  return null
}

/**
 * What the arrival answered, with the unknown patient's Health ID once, for the wristband. A patient already on the
 * board keeps their record as it was: a triage level or complaint entered here is not saved (hid-system ED-1 route 1),
 * so the page says so plainly, shows the level the board has, and points to the record to triage them.
 */
function Arrived({ done, onAnother }: {
  readonly done: Done
  readonly onAnother: () => void
}) {
  const navigate = useNavigate()
  const card = done.arrived.attendance
  const name = cardName(card)
  const already = done.arrived.outcome === 'already_on_board'
  const notSaved = already ? notSavedTitle(done.levelSent, done.complaintSent) : null
  const said = already ? `${name} is already on the board.`
    : done.arrived.outcome === 'moved_from_waiting_list' ? `${name} was moved from the waiting list to the board.`
      : `${name} is on the board.`
  return (
    <DeptPage eyebrow={EYEBROW} title="New arrival" onBack={() => navigate(BASE)} backLabel="Back to the board">
      <DeptNotice tone={already ? 'info' : 'positive'} variant="box" role="status">
        <span id="ed-arrived-title" tabIndex={-1}>{said}</span>
      </DeptNotice>
      {notSaved ? (
        <DeptNotice tone="caution" variant="box" role="alert" title={notSaved}>
          The board still shows {name} as: {triageText(card.triageLevel)}. To change it, open their record and select Triage.
        </DeptNotice>
      ) : null}
      {done.wristband ? <Wristband made={done.wristband} /> : null}
      <div className="hid-ehr-dept-form-actions">
        <Link className="hid-ehr-button" to={`${BASE}/${card.attendanceId}`}>Open their record</Link>
        <EhrButton variant="secondary" onClick={onAnother}>Add another arrival</EhrButton>
        <Link className="hid-ehr-button hid-ehr-button-secondary" to={BASE}>Back to the board</Link>
      </div>
    </DeptPage>
  )
}

/**
 * An unknown patient's label and full Health ID, to write or print on the wristband (ID-7 answers the Health ID when the
 * record is made, and only then; later lists show its last 4 characters). On this page only, never stored.
 */
function Wristband({ made }: { readonly made: UnknownPatientMade }) {
  const { facility } = useDeptAccess()
  return (
    <DeptSection title="Wristband" headingId="ed-wristband" className="hid-ehr-dept-emergency-wristband">
      <p className="hid-ehr-dept-waiting-hint">Write or print this on the patient’s wristband now. It is not shown again once you leave this page.</p>
      <p className="hid-ehr-dept-emergency-wristband-line"><strong>Unknown patient {made.label}</strong></p>
      <p className="hid-ehr-dept-emergency-wristband-line">Health ID <strong>{made.hid}</strong></p>
      <div className="hid-ehr-dept-form-actions">
        {/* The wristband slip alone, as a paper (printPaper: a PDF in Safari and on an iPhone or iPad, so no browser
            prints its web address on it, owner 23 Nov 2026), never the page as it is. */}
        <EhrButton variant="secondary" onClick={event => printPaper(receiptFor(event.currentTarget, 'health-id'), WRISTBAND_PAPER)}>
          Print wristband
        </EhrButton>
      </div>
      <section data-receipt-print="health-id" aria-hidden="true" className="hidden print:block">
        <div className="flex flex-col gap-2 p-4 text-black">
          <PrintHeader facility={facility?.name} stacked />
          <p className="m-0 text-[18px] font-semibold">Unknown patient {made.label}</p>
          <p className="m-0 text-[14px]">Health ID</p>
          <p className="m-0 text-[26px] font-semibold tracking-[.06em]">{made.hid}</p>
        </div>
      </section>
    </DeptSection>
  )
}

function UnknownFields({ value, onChange }: { readonly value: Unknown; readonly onChange: (next: Partial<Unknown>) => void }) {
  return (
    <div className="hid-ehr-dept-form">
      <p className="hid-ehr-dept-waiting-hint">{UNKNOWN_HINT}</p>
      <div className="hid-ehr-dept-form-grid">
        <EhrField label="Sex" controlId="ed-unknown-sex">
          <EhrSelect value={value.gender} onChange={event => onChange({ gender: event.target.value as Unknown['gender'] })}>
            <option value="">Choose</option>
            {UNKNOWN_SEXES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Estimated age in years (optional)" controlId="ed-unknown-age">
          <EhrInput inputMode="numeric" value={value.age} onChange={event => onChange({ age: event.target.value })} maxLength={3} autoComplete="off" />
        </EhrField>
        <EhrField label="Why they cannot say who they are" controlId="ed-unknown-reason">
          <EhrSelect value={value.reason} onChange={event => onChange({ reason: event.target.value as Unknown['reason'] })}>
            <option value="">Choose</option>
            {UNKNOWN_REASONS.map(reason => <option key={reason} value={reason}>{UNKNOWN_REASON_WORDS[reason]}</option>)}
          </EhrSelect>
        </EhrField>
      </div>
      <EhrField label="Arrival note (optional)" controlId="ed-unknown-note" hint="Who brought them, where they were found, what they were wearing. Kept private.">
        <EhrTextarea rows={3} value={value.note} onChange={event => onChange({ note: event.target.value })} maxLength={1000} />
      </EhrField>
    </div>
  )
}

/**
 * The staff patient search (0132) by name, date of birth, phone or Health ID, all in the request body; a card is chosen
 * by its matchRef, which stays out of the page's markup and is used within 10 minutes. Choose and Choose someone else
 * each remove the button pressed, so focus moves on with the work (`onPicked`, the page's own focus request, which the
 * page's later requests replace): to the patient chosen, or back to the search's first field.
 */
function ArrivalSearch({ facilityId, chosen, onChoose, onPicked }: {
  readonly facilityId: string
  readonly chosen: PatientSearchCard | null
  readonly onChoose: (card: PatientSearchCard | null) => void
  readonly onPicked: (id: string) => void
}) {
  const [values, setValues] = useState<SearchValues>(EMPTY_SEARCH)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const [cards, setCards] = useState<readonly PatientSearchCard[]>([])
  const focus = useFocusById()

  function change(next: Partial<SearchValues>) { setValues(previous => ({ ...previous, ...next })) }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const keys = searchKeys(values)
    setError(''); setSaid(null)
    if (!keys) { setError(SEARCH_EMPTY); return }
    setBusy(true)
    onChoose(null)
    try {
      const answer = await staffApi.searchPatients(facilityId, keys)
      const found = answer.outcome === 'found' ? answer.patients : []
      setCards(found)
      setSaid(found.length === 0 ? noCardText(answer) : null)
      focus(found.length > 0 ? 'ed-search-results-title' : 'ed-search-said')
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      setCards([])
      setError(searchRefusal(caught))
    } finally { setBusy(false) }
  }

  if (chosen) {
    return (
      <div id="ed-arrival-chosen" tabIndex={-1} role="group" className="hid-ehr-dept-waiting-card" aria-label={`Chosen: ${chosen.fullName}`}>
        <div className="hid-ehr-dept-waiting-main">
          <p className="hid-ehr-dept-waiting-name">{chosen.fullName}</p>
          <CardIdentity card={chosen} />
        </div>
        <div className="hid-ehr-dept-waiting-actions">
          <EhrButton size="sm" variant="secondary" onClick={() => { onChoose(null); onPicked('ed-search-first-name') }}>Choose someone else</EhrButton>
        </div>
      </div>
    )
  }

  return (
    <>
      <form className="hid-ehr-dept-form" noValidate onSubmit={event => void search(event)} aria-label="Find the patient">
        <p className="hid-ehr-dept-waiting-hint">{SEARCH_HINT}</p>
        <div className="hid-ehr-dept-form-grid">
          <EhrField label="First name" controlId="ed-search-first-name">
            <EhrInput value={values.firstName} onChange={event => change({ firstName: event.target.value })} maxLength={100} autoComplete="off" spellCheck={false} />
          </EhrField>
          <EhrField label="Last name" controlId="ed-search-last-name">
            <EhrInput value={values.lastName} onChange={event => change({ lastName: event.target.value })} maxLength={100} autoComplete="off" spellCheck={false} />
          </EhrField>
          <EhrField label="Date of birth" controlId="ed-search-date-of-birth">
            <EhrInput type="date" value={values.dateOfBirth} onChange={event => change({ dateOfBirth: event.target.value })} autoComplete="off" />
          </EhrField>
          <EhrField label="Phone number" controlId="ed-search-phone">
            <EhrInput type="tel" value={values.phone} onChange={event => change({ phone: event.target.value })} maxLength={24} autoComplete="off" />
          </EhrField>
          <EhrField label="Health ID" controlId="ed-search-health-id" hint="It starts with HID-.">
            <EhrInput value={values.healthId} onChange={event => change({ healthId: event.target.value })} maxLength={36}
              autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </EhrField>
        </div>
        {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
        <div className="hid-ehr-dept-form-actions">
          <EhrButton type="submit" variant="secondary" busy={busy}>Find patient</EhrButton>
        </div>
      </form>
      {said ? <p id="ed-search-said" tabIndex={-1} role="status" className="hid-ehr-state-message">{said}</p> : null}
      {cards.length > 0 ? (
        <div className="hid-ehr-dept-waiting-results">
          <h3 id="ed-search-results-title" tabIndex={-1}>{countText(cards.length, 'patient')} found</h3>
          <ul className="hid-ehr-dept-waiting-list" aria-labelledby="ed-search-results-title">
            {cards.map((card, index) => {
              const headingId = `ed-found-${index}`
              return (
                <li key={card.matchRef} className="hid-ehr-dept-waiting-card" aria-labelledby={headingId}>
                  <div className="hid-ehr-dept-waiting-main">
                    <h4 id={headingId} className="hid-ehr-dept-waiting-name">{card.fullName}</h4>
                    <CardIdentity card={card} />
                  </div>
                  <div className="hid-ehr-dept-waiting-actions">
                    <EhrButton size="sm" aria-label={`Choose ${card.fullName}`} onClick={() => { onChoose(card); onPicked('ed-arrival-chosen') }}>Choose</EhrButton>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </>
  )
}

function CardIdentity({ card }: { readonly card: PatientSearchCard }) {
  const parts = [sexText(card.sex), card.dateOfBirth ? `Born ${birthDateText(card.dateOfBirth)}` : ''].filter(Boolean)
  return (
    <>
      <p className="hid-ehr-dept-waiting-identity">
        {parts.length > 0 ? <span>{parts.join(' · ')}</span> : null}
        {card.healthIdLast4 ? <span aria-label={`Health ID ending ${card.healthIdLast4}`}>{healthIdEnding(card.healthIdLast4)}</span> : null}
      </p>
      <div className="hid-ehr-dept-waiting-badges">
        <EhrBadge tone={card.ninStatus === 'verified' ? 'positive' : 'neutral'}>{ninStatusLabel(card.ninStatus)}</EhrBadge>
      </div>
    </>
  )
}
