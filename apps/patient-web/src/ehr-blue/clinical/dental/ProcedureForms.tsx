import { EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { useId, useState, type FormEvent } from 'react'
import type {
  DentalAnaestheticInput, DentalArch, DentalDentition, DentalLists, DentalProcedure, DentalProcedureInput, DentalSite,
} from '../../../staff/api'
import {
  ARCH_WORDS, CARTRIDGES, CATEGORY_ORDER, NOTES_MAX, NOT_ON_LIST, NO_ANAESTHETIC, OTHER_ANAESTHETIC, PROCEDURE_NAME_MAX,
  QUADRANT_WORDS, SITES, SITE_WORDS, SURFACES, categoryText, doneMoment, doneTimeProblem, orderedSurfaces, procedureNameProblem,
  reasonProblem, surfaceWord, teethOf, textOrNull, textProblem, toothText,
} from './dentalRules'

/*
 * The procedure forms of the dental visit (DEN-1 routes 9-12): plan a procedure or record one done, record a planned one
 * as done, and the reason for a cancel or an entered-in-error mark. A procedure is chosen from the dental list (its site
 * is the list's) or typed by name with its site (Q-DEN-5 A, shown "Not on the list"). Recording a procedure done records
 * the local anaesthetic (Q-DEN-6 A: an agent from the list, or No local anaesthetic) and is the dentist's signature: an
 * explicit statement of who did it and when, with no cryptographic signature claim. The server checks every rule again.
 */

export const BY_NAME = '__by_name__'
export const ATTESTATION = 'I did this procedure, at the time shown. Recording it signs it as done by me.'

type Problems = Partial<Record<string, string>>

interface AnaestheticValues { agent: string; other: string; technique: string; cartridges: string }
const NO_VALUES: AnaestheticValues = { agent: '', other: '', technique: '', cartridges: '' }

function anaestheticInput(values: AnaestheticValues): DentalAnaestheticInput {
  if (values.agent === NO_ANAESTHETIC) return { agentCode: NO_ANAESTHETIC, agentOther: null, techniqueCode: null, cartridges: null }
  return {
    agentCode: values.agent,
    agentOther: values.agent === OTHER_ANAESTHETIC ? values.other.trim() : null,
    techniqueCode: values.technique,
    cartridges: Number(values.cartridges),
  }
}

function anaestheticProblems(values: AnaestheticValues): Problems {
  const problems: Problems = {}
  if (!values.agent) problems.agent = 'Choose the local anaesthetic used, or No local anaesthetic.'
  if (values.agent && values.agent !== NO_ANAESTHETIC) {
    if (!values.technique) problems.technique = 'Choose how it was given.'
    if (!values.cartridges) problems.cartridges = 'Choose the amount, in cartridges.'
    if (values.agent === OTHER_ANAESTHETIC) {
      const length = values.other.trim().length
      if (length < 2) problems.other = 'Type the anaesthetic’s name.'
      else if (textProblem(values.other, PROCEDURE_NAME_MAX, true)) problems.other = textProblem(values.other, PROCEDURE_NAME_MAX, true)
    }
  }
  return problems
}

function AnaestheticFields({ lists, values, problems, onChange }: {
  readonly lists: DentalLists
  readonly values: AnaestheticValues
  readonly problems: Problems
  readonly onChange: (values: AnaestheticValues) => void
}) {
  const given = values.agent !== '' && values.agent !== NO_ANAESTHETIC
  return (
    <fieldset className="hid-ehr-dental-fieldset">
      <legend>Local anaesthetic</legend>
      <EhrField label="Anaesthetic used" error={problems.agent}>
        <EhrSelect value={values.agent} onChange={event => onChange({ ...values, agent: event.target.value })}>
          <option value="">Choose</option>
          {lists.anaesthetics.items.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
        </EhrSelect>
      </EhrField>
      {values.agent === OTHER_ANAESTHETIC ? (
        <EhrField label="Name of the anaesthetic" error={problems.other}>
          <EhrInput value={values.other} maxLength={PROCEDURE_NAME_MAX + 20} onChange={event => onChange({ ...values, other: event.target.value })} />
        </EhrField>
      ) : null}
      {given ? (
        <div className="hid-ehr-clinical-form-row">
          <EhrField label="How it was given" error={problems.technique}>
            <EhrSelect value={values.technique} onChange={event => onChange({ ...values, technique: event.target.value })}>
              <option value="">Choose</option>
              {lists.techniques.items.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrField label="Amount (cartridges)" error={problems.cartridges}>
            <EhrSelect value={values.cartridges} onChange={event => onChange({ ...values, cartridges: event.target.value })}>
              <option value="">Choose</option>
              {CARTRIDGES.map(amount => <option key={amount} value={String(amount)}>{amount}</option>)}
            </EhrSelect>
          </EhrField>
        </div>
      ) : null}
    </fieldset>
  )
}

function SurfaceChoices({ tooth, value, onChange, problem, legend = 'Surfaces' }: {
  readonly tooth: number | null
  readonly value: ReadonlySet<string>
  readonly onChange: (value: ReadonlySet<string>) => void
  readonly problem?: string
  readonly legend?: string
}) {
  const id = useId()
  return (
    <fieldset className="hid-ehr-dental-surfaces" aria-describedby={problem ? `${id}-error` : undefined}>
      <legend>{legend}</legend>
      {SURFACES.map(surface => (
        <label key={surface} className="hid-ehr-clinical-checkbox">
          <input type="checkbox" checked={value.has(surface)} onChange={event => {
            const next = new Set(value)
            if (event.target.checked) next.add(surface); else next.delete(surface)
            onChange(next)
          }} />
          {surface} ({surfaceWord(surface, tooth).toLowerCase()})
        </label>
      ))}
      {problem ? <p id={`${id}-error`} className="hid-ehr-clinical-field-error" role="alert">{problem}</p> : null}
    </fieldset>
  )
}

function Attestation({ checked, onChange, problem }: { readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly problem?: string }) {
  const id = useId()
  return (
    <div className="hid-ehr-dental-attest">
      <label className="hid-ehr-clinical-checkbox">
        <input type="checkbox" checked={checked} aria-describedby={problem ? `${id}-error` : undefined}
          onChange={event => onChange(event.target.checked)} />
        {ATTESTATION}
      </label>
      {problem ? <p id={`${id}-error`} className="hid-ehr-clinical-field-error" role="alert">{problem}</p> : null}
    </div>
  )
}

function DoneTime({ value, onChange, problem }: { readonly value: string; readonly onChange: (value: string) => void; readonly problem?: string }) {
  return (
    <EhrField label="Time it was done (optional, today, 24-hour clock)" hint="Leave it empty if it was done just now." error={problem}>
      <EhrInput type="time" value={value} onChange={event => onChange(event.target.value)} />
    </EhrField>
  )
}

/**
 * "Add a procedure": plan it (the treatment plan) or record it done at this visit. The site fields follow the procedure:
 * the list's site, or the one chosen for a procedure typed by name.
 */
export function AddProcedureForm({ lists, dentition, visitStartedAt, onSubmit, onClose }: {
  readonly lists: DentalLists
  readonly dentition: DentalDentition
  readonly visitStartedAt: string
  /** Answers '' once saved, or why it was not. */
  readonly onSubmit: (input: DentalProcedureInput) => Promise<string>
  readonly onClose: () => void
}) {
  const [status, setStatus] = useState<'planned' | 'done'>('planned')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [chosenSite, setChosenSite] = useState<DentalSite | ''>('')
  const [tooth, setTooth] = useState('')
  const [surfaces, setSurfaces] = useState<ReadonlySet<string>>(new Set())
  const [quadrant, setQuadrant] = useState('')
  const [arch, setArch] = useState<DentalArch | ''>('')
  const [time, setTime] = useState('')
  const [anaesthetic, setAnaesthetic] = useState<AnaestheticValues>(NO_VALUES)
  const [notes, setNotes] = useState('')
  const [attested, setAttested] = useState(false)
  const [problems, setProblems] = useState<Problems>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const byName = code === BY_NAME
  const item = lists.procedures.items.find(entry => entry.code === code)
  const site: DentalSite | '' = byName ? chosenSite : item?.site ?? ''
  const teeth = teethOf(dentition)
  const toothNumber = tooth ? Number(tooth) : null
  const grouped = CATEGORY_ORDER.map(category => [category, lists.procedures.items.filter(entry => entry.category === category)] as const)
    .filter(([, items]) => items.length > 0)

  function check(): Problems {
    const found: Problems = {}
    if (!code) found.code = 'Choose a procedure from the dental list, or Not on the list.'
    if (byName) {
      const nameProblem = procedureNameProblem(name)
      if (nameProblem) found.name = nameProblem
      if (!chosenSite) found.site = 'Say where it is done.'
    }
    if ((site === 'tooth' || site === 'tooth_surfaces') && !tooth) found.tooth = 'Choose the tooth.'
    if (site === 'tooth_surfaces' && surfaces.size === 0) found.surfaces = 'Choose at least one surface.'
    if (site === 'quadrant' && !quadrant) found.quadrant = 'Choose the quadrant.'
    if (site === 'arch' && !arch) found.arch = 'Choose the arch.'
    const notesProblem = textProblem(notes, NOTES_MAX)
    if (notesProblem) found.notes = notesProblem
    if (status === 'done') {
      Object.assign(found, anaestheticProblems(anaesthetic))
      const timeProblem = doneTimeProblem(time, visitStartedAt)
      if (timeProblem) found.time = timeProblem
      if (!attested) found.attest = 'Tick the statement to sign the procedure as done.'
    }
    return found
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const found = check()
    setProblems(found)
    setError('')
    if (Object.keys(found).length > 0) return
    const moment = status === 'done' && time ? doneMoment(time) : null
    const input: DentalProcedureInput = {
      status,
      procedureCode: byName ? null : code,
      procedureName: byName ? name.trim() : null,
      site: byName ? (chosenSite || null) : null,
      tooth: site === 'tooth' || site === 'tooth_surfaces' ? toothNumber : null,
      surfaces: site === 'tooth_surfaces' ? orderedSurfaces(surfaces) : null,
      quadrant: site === 'quadrant' ? Number(quadrant) : null,
      arch: site === 'arch' && arch ? arch : null,
      ...(status === 'done' ? { anaesthetic: anaestheticInput(anaesthetic), ...(moment ? { doneAt: moment } : {}) } : {}),
      notes: textOrNull(notes),
    }
    setBusy(true)
    try {
      const why = await onSubmit(input)
      if (why) setError(why)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="hid-ehr-clinical-form hid-ehr-dental-form" noValidate onSubmit={event => void submit(event)} aria-label="Add a procedure">
      <fieldset className="hid-ehr-dental-fieldset">
        <legend>What are you recording?</legend>
        <label className="hid-ehr-clinical-choice">
          <input type="radio" name="dental-procedure-status" checked={status === 'planned'} onChange={() => setStatus('planned')} />
          Plan it (treatment plan)
        </label>
        <label className="hid-ehr-clinical-choice">
          <input type="radio" name="dental-procedure-status" checked={status === 'done'} onChange={() => setStatus('done')} />
          Done at this visit
        </label>
      </fieldset>
      <EhrField label="Procedure" error={problems.code}>
        <EhrSelect value={code} onChange={event => { setCode(event.target.value); setProblems({}) }}>
          <option value="">Choose a procedure</option>
          {grouped.map(([category, items]) => (
            <optgroup key={category} label={categoryText(category)}>
              {items.map(entry => <option key={entry.code} value={entry.code}>{entry.name}</option>)}
            </optgroup>
          ))}
          <option value={BY_NAME}>{NOT_ON_LIST}: type its name</option>
        </EhrSelect>
      </EhrField>
      {byName ? (
        <>
          <EhrField label="Procedure name" hint={`2 to ${PROCEDURE_NAME_MAX} characters. It is recorded as not on the list.`} error={problems.name}>
            <EhrInput value={name} maxLength={PROCEDURE_NAME_MAX + 20} onChange={event => setName(event.target.value)} />
          </EhrField>
          <EhrField label="Where it is done" error={problems.site}>
            <EhrSelect value={chosenSite} onChange={event => setChosenSite(event.target.value as DentalSite | '')}>
              <option value="">Choose</option>
              {SITES.map(value => <option key={value} value={value}>{SITE_WORDS[value]}</option>)}
            </EhrSelect>
          </EhrField>
        </>
      ) : null}
      {site === 'tooth' || site === 'tooth_surfaces' ? (
        <EhrField label="Tooth" error={problems.tooth}>
          <EhrSelect value={tooth} onChange={event => setTooth(event.target.value)}>
            <option value="">Choose a tooth</option>
            {teeth.map(value => <option key={value} value={String(value)}>{toothText(value)}</option>)}
          </EhrSelect>
        </EhrField>
      ) : null}
      {site === 'tooth_surfaces' ? <SurfaceChoices tooth={toothNumber} value={surfaces} onChange={setSurfaces} problem={problems.surfaces} /> : null}
      {site === 'quadrant' ? (
        <EhrField label="Quadrant" error={problems.quadrant}>
          <EhrSelect value={quadrant} onChange={event => setQuadrant(event.target.value)}>
            <option value="">Choose</option>
            {[1, 2, 3, 4].map(value => <option key={value} value={String(value)}>{QUADRANT_WORDS[value]}</option>)}
          </EhrSelect>
        </EhrField>
      ) : null}
      {site === 'arch' ? (
        <EhrField label="Arch" error={problems.arch}>
          <EhrSelect value={arch} onChange={event => setArch(event.target.value as DentalArch | '')}>
            <option value="">Choose</option>
            <option value="upper">{ARCH_WORDS.upper}</option>
            <option value="lower">{ARCH_WORDS.lower}</option>
          </EhrSelect>
        </EhrField>
      ) : null}
      {status === 'done' ? (
        <>
          <DoneTime value={time} onChange={setTime} problem={problems.time} />
          <AnaestheticFields lists={lists} values={anaesthetic} problems={problems} onChange={setAnaesthetic} />
        </>
      ) : null}
      <EhrField label="Notes (optional)" error={problems.notes}>
        <EhrTextarea value={notes} rows={2} maxLength={NOTES_MAX + 50} onChange={event => setNotes(event.target.value)} />
      </EhrField>
      {status === 'done' ? <Attestation checked={attested} onChange={setAttested} problem={problems.attest} /> : null}
      {error ? <div className="hid-ehr-clinical-alert" role="alert"><p>{error}</p></div> : null}
      <div className="hid-ehr-clinical-form-footer">
        <EhrButton type="submit" busy={busy}>{status === 'done' ? 'Record as done and sign' : 'Add to treatment plan'}</EhrButton>
        <EhrButton variant="quiet" onClick={onClose} disabled={busy}>Close</EhrButton>
      </div>
    </form>
  )
}

/** "Record as done" on a planned procedure (route 10): the anaesthetic, the time, the surfaces (refined) and the signature. */
export function DoneForm({ procedure, lists, visitStartedAt, onSubmit, onClose }: {
  readonly procedure: DentalProcedure
  readonly lists: DentalLists
  readonly visitStartedAt: string
  readonly onSubmit: (input: { doneAt?: string; anaesthetic: DentalAnaestheticInput; surfaces?: string; notes?: string | null }) => Promise<string>
  readonly onClose: () => void
}) {
  const [time, setTime] = useState('')
  const [anaesthetic, setAnaesthetic] = useState<AnaestheticValues>(NO_VALUES)
  const [surfaces, setSurfaces] = useState<ReadonlySet<string>>(new Set(procedure.surfaces ?? ''))
  const [notes, setNotes] = useState('')
  const [attested, setAttested] = useState(false)
  const [problems, setProblems] = useState<Problems>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const found: Problems = { ...anaestheticProblems(anaesthetic) }
    const timeProblem = doneTimeProblem(time, visitStartedAt)
    if (timeProblem) found.time = timeProblem
    if (procedure.site === 'tooth_surfaces' && surfaces.size === 0) found.surfaces = 'Choose at least one surface.'
    const notesProblem = textProblem(notes, NOTES_MAX)
    if (notesProblem) found.notes = notesProblem
    if (!attested) found.attest = 'Tick the statement to sign the procedure as done.'
    setProblems(found)
    setError('')
    if (Object.keys(found).length > 0) return
    const moment = time ? doneMoment(time) : null
    const refined = procedure.site === 'tooth_surfaces' ? orderedSurfaces(surfaces) : ''
    setBusy(true)
    try {
      const why = await onSubmit({
        ...(moment ? { doneAt: moment } : {}),
        anaesthetic: anaestheticInput(anaesthetic),
        ...(refined && refined !== procedure.surfaces ? { surfaces: refined } : {}),
        ...(textOrNull(notes) ? { notes: textOrNull(notes) } : {}),
      })
      if (why) setError(why)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="hid-ehr-clinical-form hid-ehr-dental-form" noValidate onSubmit={event => void submit(event)}
      aria-label={`Record ${procedure.procedureName} as done`}>
      {procedure.site === 'tooth_surfaces'
        ? <SurfaceChoices tooth={procedure.tooth} value={surfaces} onChange={setSurfaces} problem={problems.surfaces} legend="Surfaces treated" />
        : null}
      <DoneTime value={time} onChange={setTime} problem={problems.time} />
      <AnaestheticFields lists={lists} values={anaesthetic} problems={problems} onChange={setAnaesthetic} />
      <EhrField label="Notes (optional)" error={problems.notes}>
        <EhrTextarea value={notes} rows={2} maxLength={NOTES_MAX + 50} onChange={event => setNotes(event.target.value)} />
      </EhrField>
      <Attestation checked={attested} onChange={setAttested} problem={problems.attest} />
      {error ? <div className="hid-ehr-clinical-alert" role="alert"><p>{error}</p></div> : null}
      <div className="hid-ehr-clinical-form-footer">
        <EhrButton type="submit" busy={busy}>Record as done and sign</EhrButton>
        <EhrButton variant="quiet" onClick={onClose} disabled={busy}>Close</EhrButton>
      </div>
    </form>
  )
}

/** A reason of 8 to 500 characters, for a cancel or an entered-in-error mark, with the button that sends it. */
export function ReasonForm({ label, submit, danger = false, onSubmit, onClose, hint }: {
  readonly label: string
  readonly submit: string
  readonly danger?: boolean
  readonly hint?: string
  readonly onSubmit: (reason: string) => Promise<string>
  readonly onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const found = reasonProblem(reason)
    setProblem(found)
    setError('')
    if (found) return
    setBusy(true)
    try {
      const why = await onSubmit(reason.trim())
      if (why) setError(why)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="hid-ehr-clinical-form hid-ehr-dental-form" noValidate onSubmit={event => void send(event)} aria-label={label}>
      <EhrField label={label} hint={hint ?? 'At least 8 characters. Kept with the record.'} error={problem || undefined}>
        <EhrTextarea value={reason} rows={2} maxLength={550} onChange={event => { setReason(event.target.value); setProblem('') }} />
      </EhrField>
      {error ? <div className="hid-ehr-clinical-alert" role="alert"><p>{error}</p></div> : null}
      <div className="hid-ehr-clinical-form-footer">
        <EhrButton type="submit" variant={danger ? 'danger' : 'secondary'} busy={busy}>{submit}</EhrButton>
        <EhrButton variant="quiet" onClick={onClose} disabled={busy}>Close</EhrButton>
      </div>
    </form>
  )
}
