import { EhrButton } from '@hid/ui/ehr'
import { DeptFacts } from '../parts/DeptRecord'
import {
  above, AMOUNT_TEXT, QUANTITY_TEXT, recordName, recordOptions, type SampleApplied, type SampleConnection, type SampleDefinition, type SampleRecord,
  type SampleValues,
} from '../parts/sample/model'
import { SAMPLE_SERVICES } from './admin'

/*
 * Sample definitions: Patient billing, Insurance & Claims and Policies, the design's Finance module. Fields, actions
 * and statuses follow the design's catalogue; every row and patient is fictional, and every payment simulated.
 */

const reason = { key: 'reason', label: 'Reason', type: 'textarea' } as const

/** A service's price in minor currency units (cents / kobo). */
function unitCents(service: string | undefined) {
  return Number(SAMPLE_SERVICES.find(row => row.values.name === service)?.values.price ?? 0) * 100
}

/** An invoice's total, what was paid less refunds, and what is still due, in minor currency units. */
function balance(invoice: SampleRecord) {
  const total = Number(invoice.values.totalCents ?? 0)
  const paid = invoice.state?.paidCents ?? 0
  return { total, paid, due: total - paid }
}

/** An amount in currency units as minor units, or undefined unless above zero. */
function cents(value: string | undefined) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : undefined
}

const demo1: SampleValues = {
  service: 'Fictional consultation', quantity: '2', source: 'SERVICE-001', number: 'DEMO-1', unitCents: '500000', totalCents: '1000000',
}
const demo2: SampleValues = {
  service: 'General consultation', quantity: '1', source: 'SERVICE-002', number: 'DEMO-2', unitCents: '500000', totalCents: '500000',
}

const INVOICES: readonly SampleRecord[] = [
  {
    id: '58b3ab2d-4f5a-4b6c-8d7e-6b5c8d9e0f26', status: 'partial', patientId: 'sample-patient-1',
    values: { ...demo1, amount: '4000', method: 'Cash', reference: 'TX-1' }, state: { paidCents: 400000 }, updatedAt: '2026-10-26T11:41:16.298Z',
    versions: [
      { at: '2026-10-26T11:41:16.028Z', status: 'draft', reason: 'Issue invoice', values: demo1 },
      { at: '2026-10-26T11:41:16.298Z', status: 'issued', reason: 'Record simulated payment', values: demo1 },
    ],
  },
  {
    id: 'c0eaed9b-5a6b-4c7d-9e8f-7c6d9e0f1a27', status: 'issued', patientId: 'sample-patient-2', values: demo2, state: { paidCents: 0 },
    updatedAt: '2026-10-26T11:41:16.100Z',
    versions: [{ at: '2026-10-26T11:41:16.100Z', status: 'draft', reason: 'Issue invoice', values: demo2 }],
  },
  {
    id: '838ce9f1-6b7c-4d8e-8f9a-8d7e0f1a2b28', status: 'draft', patientId: 'sample-patient-3', state: { paidCents: 0 },
    values: { service: 'General consultation', quantity: '1', source: 'SERVICE-003', number: 'DEMO-3', unitCents: '500000', totalCents: '500000' },
    updatedAt: '2026-10-26T11:41:16.000Z', versions: [],
  },
]

const claim2: SampleValues = { invoice: 'DEMO-2', policy: 'POL-DEMO', authorization: 'AUTH-DEMO', support: 'Invoice and service' }
const claim1: SampleValues = { invoice: 'DEMO-1', policy: 'POL-DEMO-2', authorization: 'AUTH-DEMO-2', support: 'Consultation record (fictional)' }

const CLAIMS: readonly SampleRecord[] = [
  {
    id: '2a6f15aa-7c8d-4e9f-9a0b-9e8f1a2b3c29', status: 'submitted', patientId: 'sample-patient-2', values: claim2,
    updatedAt: '2026-10-26T11:41:16.133Z',
    versions: [{ at: '2026-10-26T11:41:16.133Z', status: 'draft', reason: 'Submit simulated claim', values: claim2 }],
  },
  {
    id: '9d41c7b3-8d9e-4f0a-8b1c-0f9a2b3c4d30', status: 'approved', patientId: 'sample-patient-1',
    values: { ...claim1, approvedAmount: '4000', review: 'Approved in part (fictional)' }, updatedAt: '2026-10-26T11:41:16.400Z',
    versions: [
      { at: '2026-10-26T11:41:16.350Z', status: 'draft', reason: 'Submit simulated claim', values: claim1 },
      { at: '2026-10-26T11:41:16.400Z', status: 'submitted', reason: 'Record payer decision', values: claim1 },
    ],
  },
  {
    id: 'e5f20b68-9e0f-4a1b-9c2d-1a0b3c4d5e31', status: 'draft', patientId: 'sample-patient-3', updatedAt: '2026-10-26T11:41:16.000Z', versions: [],
    values: { invoice: 'DEMO-3', policy: 'POL-DEMO-3', authorization: 'AUTH-DEMO-3', support: 'Consultation record (fictional)' },
  },
]

const POLICIES: readonly SampleRecord[] = [
  {
    id: 'b857052c-0f1a-4b2c-8d3e-2b1c4d5e6f32', status: 'active', patientId: 'sample-patient-2', updatedAt: '2026-10-26T11:41:16.000Z', versions: [],
    values: { insurer: 'Demo HMO', number: 'POL-DEMO', expiry: '2030-01-01', coverage: 'Fictional coverage' },
  },
  {
    id: '3fa6d190-1a2b-4c3d-9e4f-3c2d5e6f7a33', status: 'active', patientId: 'sample-patient-1', updatedAt: '2026-10-26T11:41:16.000Z', versions: [],
    values: { insurer: 'Sample Health Plan (fictional)', number: 'POL-DEMO-2', expiry: '2028-06-30', coverage: 'Outpatient care (fictional)' },
  },
  {
    id: '71c8e2a4-2b3c-4d4e-8f5a-4d3e6f7a8b34', status: 'active', patientId: 'sample-patient-3', updatedAt: '2026-10-26T11:41:16.000Z', versions: [],
    values: { insurer: 'Demo HMO', number: 'POL-DEMO-3', expiry: '2027-12-31', coverage: 'Fictional coverage' },
  },
]

const FINANCE = [
  { page: 'patient-billing', title: 'Patient billing', records: INVOICES },
  { page: 'insurance', title: 'Insurance & Claims', records: CLAIMS },
  { page: 'policies', title: 'Policies', records: POLICIES },
]

/** The patient's records in the other Finance workspaces, in the design's order. */
function connectedTo(page: string) {
  return (patientId: string): readonly SampleConnection[] => FINANCE.filter(module => module.page !== page).flatMap(module => module.records
    .filter(record => record.patientId === patientId)
    .map(record => ({ key: `${module.page}-${record.id}`, page: module.page, title: module.title, name: recordName(record), status: record.status })))
}

/** The patient's own records of a workspace, as a select's choices. */
function patientOptions(records: readonly SampleRecord[]) {
  return ({ patientId }: { readonly patientId?: string }) => recordOptions(records.filter(record => !patientId || record.patientId === patientId))
}

export const billingSample: SampleDefinition = {
  id: 'billing',
  title: 'Patient billing',
  patient: true,
  initial: 'draft',
  fields: [
    { key: 'service', label: 'Service charge', options: () => recordOptions(SAMPLE_SERVICES) },
    { key: 'quantity', label: 'Service quantity', type: 'number' },
    { key: 'source', label: 'Unique charge reference (order / service ID)' },
  ],
  defaults: { quantity: '1' },
  validate: (values, records) => {
    if (above(values.quantity) === undefined) return QUANTITY_TEXT
    // One charge for one service event: an invoice that was voided frees its reference.
    if (records.some(record => record.values.source === values.source && record.status !== 'void')) return 'This service event has already been charged.'
    return undefined
  },
  created: (values, sequence) => {
    const unit = unitCents(values.service)
    return {
      values: { number: `DEMO-${sequence}`, unitCents: String(unit), totalCents: String(unit * Number(values.quantity ?? 0)) },
      state: { paidCents: 0 },
    }
  },
  // A draft's service or quantity changed: its unit price and total follow.
  edited: (record, values) => {
    const unit = unitCents(values.service ?? record.values.service)
    return { values: { unitCents: String(unit), totalCents: String(unit * Number(values.quantity ?? record.values.quantity ?? 0)) } }
  },
  actions: [
    { id: 'issue', label: 'Issue invoice', from: ['draft'], to: 'issued' },
    {
      id: 'pay', label: 'Record simulated payment', from: ['issued', 'partial'], to: 'partial',
      fields: [
        { key: 'amount', label: 'Amount (currency units)', type: 'number' },
        { key: 'method', label: 'Method', options: ['Cash', 'Transfer', 'Card', 'Insurance'] },
        { key: 'reference', label: 'Unique transaction reference' },
      ],
    },
    {
      id: 'refund', label: 'Refund payment', from: ['paid', 'partial'], to: 'partial',
      fields: [{ key: 'amount', label: 'Refund amount', type: 'number' }, reason],
    },
    { id: 'void', label: 'Void invoice', from: ['draft', 'issued'], to: 'void', fields: [reason] },
  ],
  apply: ({ record, records, action, values }) => {
    const { paid, due } = balance(record)
    if (action.id === 'void' && paid > 0) return { error: 'Refund collected payments before voiding.' }
    if (action.id !== 'pay' && action.id !== 'refund') return {}
    const amount = cents(values.amount)
    if (amount === undefined) return { error: AMOUNT_TEXT }
    if (action.id === 'pay' && amount > due) return { error: 'Payment exceeds outstanding balance.' }
    if (action.id === 'pay' && [record, ...records].some(row => row.values.reference === values.reference)) {
      return { error: 'Transaction reference already recorded.' }
    }
    if (action.id === 'refund' && amount > paid) return { error: 'Refund exceeds refundable balance.' }
    const nowPaid = action.id === 'pay' ? paid + amount : paid - amount
    const nowDue = Number(record.values.totalCents ?? 0) - nowPaid
    return { status: nowDue === 0 ? 'paid' : nowPaid > 0 ? 'partial' : 'issued', state: { ...record.state, paidCents: nowPaid } }
  },
  // No receipt to download: a sample hands out no file. Print stays.
  savedExtra: record => {
    const totals = balance(record)
    return (
      <>
        <DeptFacts className="hid-ehr-dept-sample-totals" facts={[
          { label: 'Total', value: String(totals.total) },
          { label: 'Paid', value: String(totals.paid) },
          { label: 'Due', value: String(totals.due) },
        ]} />
        <p>Totals above are integer minor currency units (cents / kobo). All payments are fictional.</p>
        <div className="hid-ehr-dept-sample-buttons">
          <EhrButton variant="secondary" onClick={() => window.print()}>Print</EhrButton>
        </div>
      </>
    )
  },
  connected: connectedTo('patient-billing'),
  records: INVOICES,
}

export const insuranceSample: SampleDefinition = {
  id: 'insurance',
  title: 'Insurance & Claims',
  patient: true,
  initial: 'draft',
  fields: [
    { key: 'invoice', label: 'Invoice', options: patientOptions(INVOICES) },
    { key: 'policy', label: 'Patient policy', options: patientOptions(POLICIES) },
    { key: 'authorization', label: 'Authorization reference' },
    { key: 'support', label: 'Supporting service records', type: 'textarea' },
  ],
  actions: [
    { id: 'submit', label: 'Submit simulated claim', from: ['draft', 'rejected'], to: 'submitted' },
    {
      id: 'approve', label: 'Record payer decision', from: ['submitted'], to: 'approved',
      fields: [{ key: 'approvedAmount', label: 'Approved amount', type: 'number' }, { key: 'review', label: 'Local fixture decision' }],
    },
    { id: 'reject', label: 'Record rejection', from: ['submitted'], to: 'rejected', fields: [reason] },
    {
      id: 'settle', label: 'Record simulated settlement', from: ['approved'], to: 'settled',
      fields: [{ key: 'amount', label: 'Received amount', type: 'number' }, { key: 'reference', label: 'Unique settlement reference' }],
    },
  ],
  apply: ({ record, records, action, values }): SampleApplied => {
    if (action.id !== 'approve' && action.id !== 'settle') return {}
    const amount = cents(action.id === 'approve' ? values.approvedAmount : values.amount)
    if (amount === undefined) return { error: AMOUNT_TEXT }
    const invoice = INVOICES.find(row => row.values.number === record.values.invoice)
    if (action.id === 'approve') return invoice && amount > balance(invoice).total ? { error: 'Approval exceeds invoice total.' } : {}
    if (amount > (cents(record.values.approvedAmount) ?? 0) || (invoice !== undefined && amount > balance(invoice).due)) {
      return { error: 'Settlement exceeds approval or outstanding invoice balance.' }
    }
    if (records.some(row => row.values.reference === values.reference)) return { error: 'Settlement reference already recorded.' }
    return {}
  },
  connected: connectedTo('insurance'),
  records: CLAIMS,
}

export const policiesSample: SampleDefinition = {
  id: 'policies',
  title: 'Policies',
  patient: true,
  initial: 'active',
  fields: [
    { key: 'insurer', label: 'Fictional insurer' },
    { key: 'number', label: 'Policy number' },
    { key: 'expiry', label: 'Coverage expiry', type: 'date' },
    { key: 'coverage', label: 'Coverage description' },
  ],
  actions: [],
  connected: connectedTo('policies'),
  records: POLICIES,
}
