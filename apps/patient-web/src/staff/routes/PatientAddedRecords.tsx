import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { Badge, Card } from '@hid/ui'
import { staffApi } from '../api'
import { PATIENT_ENTRY_KIND_LABELS, saysListChanged, type PatientEntry } from '../../patientEntries'

const DAY = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'UTC' })
/** The day the patient entered (YYYY-MM-DD), as that same calendar day wherever the browser is. */
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? DAY.format(new Date(`${value}T00:00:00Z`)) : value

const LABEL = 'Added by the patient. Not checked by a health worker.'
const NOT_LOADED = 'The records the patient added could not be loaded.'
const OLDER_NOT_LOADED = 'Older records could not be loaded. Please try again.'
const LIST_CHANGED = 'The list changed, so it was loaded again from the start.'
const olderShown = (count: number, last: boolean) => count === 0 ? 'No older records.'
  : `${count === 1 ? '1 older record' : `${count} older records`} shown.${last ? ' That’s all of them.' : ''}`

type State =
  | { status: 'loading' } | { status: 'hidden' } | { status: 'failed' }
  | { status: 'shown'; items: PatientEntry[]; nextBefore: string | null }

/**
 * "Added by the patient" on the chart (hid-system 0116): the records the patient added themselves in their portal, read
 * only, as the chart's other reads are (the selected facility, direct care, the patient's read access there), audited as
 * a view of their record, and labelled "Added by the patient. Not checked by a health worker." They are what the patient
 * says, not a clinical finding, and do not change this record. Newest first, 50 at a time: "Show older" reads the next
 * page, moves focus to the first record it added and says how many; a list that changed meanwhile (400 INVALID_CURSOR)
 * is read again from the start. Not shown where EHR does not serve them (404: hid-system main, or switched off) or refuses
 * them (403); while the first page is read nothing is shown, as the chart's other sections do. Mounted with a patient,
 * facility and actor key, so nothing of another patient's survives. The server's own words are never shown.
 */
export function PatientAddedRecords({ facilityId, patientId }: { facilityId: string; patientId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [older, setOlder] = useState<{ loading: boolean; problem: string | null }>({ loading: false, problem: null })
  const [notice, setNotice] = useState<string | null>(null)
  const [focusTo, setFocusTo] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const title = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    request.current?.abort()
    request.current = null
    setOlder({ loading: false, problem: null })
    void (async () => {
      try {
        const page = await staffApi.patientEntries(facilityId, patientId, null, controller.signal)
        if (!controller.signal.aborted) setState({ status: 'shown', items: page.items, nextBefore: page.nextBefore })
      } catch (caught) {
        if (controller.signal.aborted) return
        // Refused or not served: nothing is shown. Only the service failing to answer says so, with a retry.
        setState(isHidApiError(caught) && caught.status !== 403 && caught.status !== 404 ? { status: 'failed' } : { status: 'hidden' })
      }
    })()
    return () => controller.abort()
  }, [facilityId, patientId, revision])
  useEffect(() => () => request.current?.abort(), [])

  // Focus after Show older, once what it shows is on the page: only from the button, or from nowhere.
  useLayoutEffect(() => {
    if (!focusTo) return
    setFocusTo(null)
    const target = focusTo === 'title' ? title.current : document.getElementById(focusTo)
    const active = document.activeElement
    const lost = !(active instanceof HTMLElement) || active === document.body || !active.isConnected
      || (active instanceof HTMLButtonElement && active.disabled) || active.id === 'patient-added-older'
    if (target?.isConnected && lost) target.focus()
  }, [focusTo])

  const showOlder = async () => {
    if (state.status !== 'shown' || !state.nextBefore || request.current) return
    const controller = new AbortController()
    request.current = controller
    setOlder({ loading: true, problem: null }); setNotice(null)
    try {
      const page = await staffApi.patientEntries(facilityId, patientId, state.nextBefore, controller.signal)
      if (controller.signal.aborted) return
      const known = new Set(state.items.map(entry => entry.id))
      const added = page.items.filter(entry => !known.has(entry.id))
      setState({ status: 'shown', items: [...state.items, ...added], nextBefore: page.nextBefore })
      setOlder({ loading: false, problem: null })
      setNotice(olderShown(added.length, page.nextBefore === null))
      if (added[0]) setFocusTo(`patient-added-${added[0].id}`)
      else if (page.nextBefore === null) setFocusTo('title')
    } catch (caught) {
      if (controller.signal.aborted) return
      if (saysListChanged(caught)) {
        setOlder({ loading: false, problem: null })
        setNotice(LIST_CHANGED)
        setFocusTo('title')
        setRevision(value => value + 1)
        return
      }
      setOlder({ loading: false, problem: OLDER_NOT_LOADED })
    } finally {
      if (request.current === controller) request.current = null
    }
  }

  if (state.status === 'loading' || state.status === 'hidden') return null
  return <section aria-labelledby="patient-added-records-title"><Card className="staff-card">
    <h2 id="patient-added-records-title" ref={title} tabIndex={-1}>Added by the patient</h2>
    <p><Badge tone="warning">Patient-reported</Badge> {LABEL}</p>
    {/* Mounted throughout, so what Show older and a reload say is announced. */}
    <div role="status" className="staff-status">{notice && <p>{notice}</p>}</div>
    {state.status === 'failed' ? <>
      <p>{NOT_LOADED}</p>
      <button type="button" className="staff-text-link" onClick={() => setRevision(value => value + 1)}>Retry records added by the patient</button>
    </> : state.items.length === 0 ? <p>The patient hasn’t added any records.</p> : <>
      <ul className="staff-patient-added">{state.items.map(entry => <li key={entry.id}>
        <h3 id={`patient-added-${entry.id}`} tabIndex={-1}>{entry.title}</h3>
        <p className="staff-muted">{[PATIENT_ENTRY_KIND_LABELS[entry.kind], entry.facilityName, day(entry.occurredOn)].filter(Boolean).join(' · ')}</p>
        {entry.notes && <p className="staff-multiline">{entry.notes}</p>}
      </li>)}</ul>
      {older.problem && <p className="staff-error" role="alert">{older.problem}</p>}
      {state.nextBefore && <button id="patient-added-older" type="button" className="staff-text-link" aria-busy={older.loading || undefined}
        onClick={() => void showOlder()}>{older.loading ? 'Loading older records…'
          : <>Show older <span className="patient-visually-hidden">records added by the patient</span></>}</button>}
    </>}
  </Card></section>
}
