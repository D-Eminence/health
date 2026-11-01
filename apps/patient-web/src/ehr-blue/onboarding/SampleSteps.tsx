import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { EhrButton, EhrCard, EhrDialog, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { Check, required } from './parts'
import { DEPARTMENTS, FACILITY_TYPES, MISSING, departmentLine, suggestedDepartments } from './setupText'
import { NEW_BRANCH_HOURS, type SampleBilling, type SampleBranch } from './setupState'

/*
 * The sample steps (screens 15, 16, 17 and 20): the design's Type, Departments, Branches and Billing, under the sample
 * notice. What they hold stays in the wizard's state for this visit; nothing is sent to Health ID or kept.
 */

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index])

/** Step 2, Type (screen 15): a type may suggest departments, and asks before replacing the ones chosen. */
export function TypeStep({ type, departments, onSave }: {
  readonly type: string
  readonly departments: readonly string[]
  readonly onSave: (type: string, departments: readonly string[]) => void
}) {
  const [value, setValue] = useState(type)
  const [problem, setProblem] = useState<string | undefined>()
  const [asking, setAsking] = useState<readonly string[] | null>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!value) { setProblem(MISSING); return }
    const preset = suggestedDepartments(value)
    if (same(preset, departments)) onSave(value, departments)
    else setAsking(preset)
  }
  return (
    <EhrCard>
      <div className="hid-ehr-onboarding-stack">
        <form noValidate aria-label="Type" className="hid-ehr-onboarding-stack" onSubmit={submit}>
          <EhrField label={required('Facility type')} error={problem} className="hid-ehr-onboarding-half">
            <EhrSelect value={value} required onChange={event => { setValue(event.target.value); setProblem(undefined) }}>
              <option value="">Select…</option>
              {FACILITY_TYPES.map(option => <option key={option}>{option}</option>)}
            </EhrSelect>
          </EhrField>
          <div><EhrButton type="submit">Next (sample)</EhrButton></div>
        </form>
        <p className="hid-ehr-onboarding-text">Each type comes with suggested settings. Clinics share the same appointments, triage and
          consultation pages. A Multi-Branch Hospital needs at least two branches.</p>
      </div>
      {/* Cancel, or Escape, keeps the departments chosen; both go on to Departments, as the design does. */}
      <EhrDialog open={asking !== null} title="Use suggested departments?" description="Cancel keeps the departments you chose."
        confirmLabel="Use suggested departments" onConfirm={() => onSave(value, asking ?? departments)}
        onCancel={() => onSave(value, departments)} />
    </EhrCard>
  )
}

/** Step 3, Departments (screen 16): which departments the hospital runs; at least one. */
export function DepartmentsStep({ departments, onSave }: {
  readonly departments: readonly string[]
  readonly onSave: (departments: readonly string[]) => void
}) {
  const id = useId()
  const [selected, setSelected] = useState<readonly string[]>(departments)
  const [problem, setProblem] = useState('')
  const toggle = (department: string) => {
    setProblem('')
    // Kept in the design's order, whatever order they are ticked in.
    setSelected(current => DEPARTMENTS.filter(name => name === department ? !current.includes(name) : current.includes(name)))
  }
  return (
    <EhrCard title="Departments you use">
      <div className="hid-ehr-onboarding-stack">
        <div className="hid-ehr-onboarding-departments">
          {DEPARTMENTS.map((department, index) => (
            <label key={department} className="hid-ehr-onboarding-department">
              <input type="checkbox" className="hid-ehr-onboarding-check-input" checked={selected.includes(department)}
                aria-labelledby={`${id}-${index}`} aria-describedby={`${id}-${index}-line`} onChange={() => toggle(department)} />
              <strong id={`${id}-${index}`}>{department}</strong>
              <small id={`${id}-${index}-line`}>{departmentLine(department)}</small>
            </label>
          ))}
        </div>
        {problem ? <p role="alert" className="hid-ehr-onboarding-problem">{problem}</p> : null}
        <div>
          <EhrButton onClick={() => (selected.length === 0 ? setProblem('Select at least one department.') : onSave(selected))}>
            Next (sample)</EhrButton>
        </div>
      </div>
    </EhrCard>
  )
}

type BranchForm = { name: string; address: string; contact: string; hours: string }
const BRANCH_FIELDS: readonly (readonly [keyof BranchForm, string])[] = [
  ['name', 'Branch name'], ['address', 'Address'], ['contact', 'Contact'], ['hours', 'Operating hours'],
]
const NEW = 'new'

const formOf = (branch: SampleBranch | undefined): BranchForm => branch
  ? { name: branch.name, address: branch.address, contact: branch.contact, hours: branch.hours }
  : { name: '', address: '', contact: '', hours: NEW_BRANCH_HOURS }

/**
 * Step 4, Branches (screen 17): each branch's details and which of the hospital's departments it runs. "Save branch"
 * keeps a branch in this sample; "Continue to staff" (below the card) moves on without it, as the design does.
 */
export function BranchesStep({ departments, branches, onSaveBranch }: {
  readonly departments: readonly string[]
  readonly branches: readonly SampleBranch[]
  readonly onSaveBranch: (branch: SampleBranch) => void
}) {
  const [selected, setSelected] = useState(branches[0]?.id ?? NEW)
  const branch = branches.find(candidate => candidate.id === selected)
  // A branch runs only departments the hospital runs: one turned off since is left unticked.
  const [runs, setRuns] = useState<readonly string[]>(() => (branch?.departments ?? departments).filter(name => departments.includes(name)))
  const [form, setForm] = useState<BranchForm>(() => formOf(branch))
  const [problems, setProblems] = useState<Partial<Record<keyof BranchForm, string>>>({})
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState('')
  const open = (id: string) => {
    const next = branches.find(candidate => candidate.id === id)
    setSelected(id)
    setRuns((next?.departments ?? departments).filter(name => departments.includes(name)))
    setForm(formOf(next))
    setProblems({})
    setProblem('')
    setSaved('')
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    const empty = Object.fromEntries(BRANCH_FIELDS.filter(([key]) => !form[key].trim()).map(([key]) => [key, MISSING]))
    setProblems(empty)
    setSaved('')
    if (Object.keys(empty).length > 0) { setProblem(''); return }
    // The design's own refusal (src/service.ts:867-875), for a branch that runs no department.
    if (runs.length === 0) { setProblem('Branch name, address, contact, hours and departments are required.'); return }
    setProblem('')
    const id = selected === NEW ? `branch-${branches.length + 1}` : selected
    onSaveBranch({ id, ...form, name: form.name.trim(), departments: runs })
    setSelected(id)
    setSaved(`${form.name.trim()} is in the branch list.`)
  }
  return (
    <EhrCard title="Branch details">
      <div className="hid-ehr-onboarding-stack">
        <div className="hid-ehr-actions">
          {branches.map(candidate => (
            <EhrButton key={candidate.id} variant="secondary" aria-pressed={candidate.id === selected} onClick={() => open(candidate.id)}>
              {candidate.name}</EhrButton>
          ))}
          <EhrButton variant="secondary" aria-pressed={selected === NEW} onClick={() => open(NEW)}>Add branch</EhrButton>
        </div>
        <fieldset className="hid-ehr-onboarding-checks">
          <legend className="hid-ehr-sr-only">Departments at this branch</legend>
          {departments.map(department => (
            <Check key={department} label={department} checked={runs.includes(department)}
              onChange={on => setRuns(current => departments.filter(name => name === department ? on : current.includes(name)))} />
          ))}
        </fieldset>
        <form noValidate aria-label="Branch" className="hid-ehr-onboarding-grid" onSubmit={save}>
          {BRANCH_FIELDS.map(([key, label]) => (
            <EhrField key={key} label={required(label)} error={problems[key]}>
              <EhrInput value={form[key]} required autoComplete="off" onChange={event => setForm({ ...form, [key]: event.target.value })} />
            </EhrField>
          ))}
          {problem ? <p role="alert" className="hid-ehr-onboarding-problem hid-ehr-onboarding-full">{problem}</p> : null}
          <div className="hid-ehr-onboarding-full"><EhrButton type="submit">Add branch (sample)</EhrButton></div>
        </form>
        <p role="status" className="hid-ehr-onboarding-text hid-ehr-onboarding-status">{saved}</p>
      </div>
    </EhrCard>
  )
}

/** Step 7, Billing (screen 20): how the hospital bills its patients, not Health ID's subscription. */
export function BillingStep({ billing, serviceCatalogue, onSave }: {
  readonly billing: SampleBilling
  /** Where the design's "Set up your list of services" goes: only where that sample opens at a demo facility. */
  readonly serviceCatalogue: string | null
  readonly onSave: (billing: SampleBilling) => void
}) {
  const [form, setForm] = useState<SampleBilling>(billing)
  const [problems, setProblems] = useState<Partial<Record<keyof SampleBilling, string>>>({})
  const text = (key: 'currency' | 'invoicePrefix' | 'methods', label: string) => (
    <EhrField label={required(label)} error={problems[key]}>
      <EhrInput value={form[key]} required autoComplete="off" onChange={event => setForm({ ...form, [key]: event.target.value })} />
    </EhrField>
  )
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const keys = ['currency', 'invoicePrefix', 'methods', 'paymentTiming'] as const
    const empty = Object.fromEntries(keys.filter(key => !form[key].trim()).map(key => [key, MISSING]))
    setProblems(empty)
    if (Object.keys(empty).length === 0) onSave(form)
  }
  return (
    <EhrCard>
      <div className="hid-ehr-onboarding-stack">
        <form noValidate aria-label="Billing" className="hid-ehr-onboarding-grid" onSubmit={submit}>
          {text('currency', 'Currency')}
          {text('invoicePrefix', 'Start of each bill number')}
          {text('methods', 'Accepted payment methods (Cash,Transfer,Card,Insurance)')}
          <EhrField label={required('When patients pay')} error={problems.paymentTiming}>
            <EhrSelect value={form.paymentTiming} required onChange={event => setForm({ ...form, paymentTiming: event.target.value })}>
              <option value="">Select…</option>
              <option>Before service</option>
              <option>After service</option>
            </EhrSelect>
          </EhrField>
          <div className="hid-ehr-onboarding-full">
            <Check label="Accept insurance" labelFirst checked={form.insurance} onChange={insurance => setForm({ ...form, insurance })} />
          </div>
          <div className="hid-ehr-onboarding-full"><EhrButton type="submit">Next (sample)</EhrButton></div>
        </form>
        <p className="hid-ehr-onboarding-text">This is for billing your patients, not a Health ID subscription. Setting prices before
          launch is optional.</p>
        {serviceCatalogue ? <p className="hid-ehr-onboarding-text">
          <Link className="hid-ehr-onboarding-link" to={serviceCatalogue}>Set up your list of services</Link></p> : null}
      </div>
    </EhrCard>
  )
}
