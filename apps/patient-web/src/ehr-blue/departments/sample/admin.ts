import { recordOptions, type SampleDefinition, type SampleRecord, type SampleValues } from '../parts/sample/model'

/*
 * Sample definitions: Service catalogue, Quality & Safety, Shifts & Roster, Dispatch and Vehicle configuration.
 * Fields, actions and statuses follow the design's catalogue; every row is fictional.
 */

const reason = { key: 'reason', label: 'Reason', type: 'textarea' } as const

function row(id: string, status: string, values: SampleValues, updatedAt: string, versions: SampleRecord['versions'] = []): SampleRecord {
  return { id, status, values, updatedAt, versions }
}

const SERVICE_ROWS: readonly SampleRecord[] = [
  row('213c4077-5d1e-4c55-9a0b-1f0a3c2b4d01', 'active', { name: 'Fictional consultation', price: '5000' }, '2026-10-26T11:41:13.000Z'),
  row('8a4f4156-0c3b-4f27-8d4e-2b1c4d5e6f02', 'active', { name: 'General consultation', price: '5000' }, '2026-10-26T11:41:13.000Z'),
  row('7cf838df-1a2b-4c3d-9e4f-3c2d5e6f7a03', 'active', { name: 'Specialist consultation', price: '15000' }, '2026-10-26T11:41:13.000Z'),
  row('6236d8a2-2b3c-4d4e-8f5a-4d3e6f7a8b04', 'active', { name: 'Full blood count', price: '2500' }, '2026-10-26T11:41:13.000Z'),
  row('6e455561-3c4d-4e5f-9a6b-5e4f7a8b9c05', 'active', { name: 'Malaria test', price: '1500' }, '2026-10-26T11:41:13.000Z'),
  row('60c2099e-4d5e-4f6a-8b7c-6f5a8b9c0d06', 'active', { name: 'Chest X-ray', price: '8000' }, '2026-10-26T11:41:13.000Z'),
  row('6005c504-5e6f-4a7b-9c8d-7a6b9c0d1e07', 'active', { name: 'Antenatal visit', price: '4000' }, '2026-10-26T11:41:13.000Z'),
]

/** The fictional services an invoice charges for, with their prices in currency units. */
export const SAMPLE_SERVICES = SERVICE_ROWS

export const servicesSample: SampleDefinition = {
  id: 'services',
  title: 'Service catalogue',
  initial: 'active',
  fields: [
    { key: 'name', label: 'Service name' },
    { key: 'price', label: 'Price', type: 'number' },
  ],
  actions: [],
  records: SERVICE_ROWS,
}

const quality: SampleValues = { title: 'Delayed sample transport (fictional)', description: 'Demo incident for quality review' }
const wetFloor: SampleValues = { title: 'Wet floor near ward entrance (fictional)', description: 'Demo incident for quality review' }

export const qualitySample: SampleDefinition = {
  id: 'quality',
  title: 'Quality & Safety',
  initial: 'reported',
  fields: [
    { key: 'title', label: 'Incident title' },
    { key: 'description', label: 'Description', type: 'textarea' },
  ],
  actions: [
    { id: 'assign', label: 'Assign reviewer', from: ['reported'], to: 'assigned', fields: [{ key: 'reviewer', label: 'Reviewer membership ID' }] },
    {
      id: 'investigate', label: 'Record investigation', from: ['assigned'], to: 'investigated',
      fields: [{ key: 'investigation', label: 'Investigation', type: 'textarea' }, { key: 'corrective', label: 'Corrective actions', type: 'textarea' }],
    },
    { id: 'resolve', label: 'Resolve incident', from: ['investigated'], to: 'resolved', fields: [{ key: 'resolution', label: 'Resolution', type: 'textarea' }] },
  ],
  records: [
    row('05aafd3d-6f7a-4b8c-8d9e-8b7c0d1e2f08', 'assigned', { ...quality, reviewer: 'Admin' }, '2026-10-26T11:41:16.763Z', [
      { at: '2026-10-26T11:41:16.763Z', status: 'reported', reason: 'Assign reviewer', values: quality },
    ]),
    row('c2e63139-7a8b-4c9d-9e0f-9c8d1e2f3a09', 'reported',
      { title: 'Near-miss labelling (fictional)', description: 'Demo near-miss for quality review' }, '2026-10-26T11:41:16.000Z'),
    row('4f0d6a21-8b9c-4d0e-8f1a-0d9e2f3a4b10', 'investigated', {
      ...wetFloor, reviewer: 'Admin', investigation: 'The warning sign was missing (fictional).',
      corrective: 'Warning signs restocked on every ward (fictional).',
    }, '2026-10-26T11:41:16.900Z', [
      { at: '2026-10-26T11:41:16.800Z', status: 'reported', reason: 'Assign reviewer', values: wetFloor },
      { at: '2026-10-26T11:41:16.900Z', status: 'assigned', reason: 'Record investigation', values: { ...wetFloor, reviewer: 'Admin' } },
    ]),
  ],
}

const STAFF = [
  { name: 'Demo Nurse A', role: 'Nurse' },
  { name: 'Demo Doctor B', role: 'Doctor' },
  { name: 'Demo Pharmacist C', role: 'Pharmacist' },
  { name: 'Demo Porter D', role: 'Porter' },
]
const DEPARTMENTS = ['General Outpatient', 'Emergency', 'Laboratory', 'Pharmacy', 'Maternity']

const nurseShift: SampleValues = { staff: 'Demo Nurse A', starts: '2026-11-02T08:00', ends: '2026-11-02T16:00', department: 'General Outpatient' }
const pharmacyShift: SampleValues = { staff: 'Demo Pharmacist C', starts: '2026-11-01T08:00', ends: '2026-11-01T16:00', department: 'Pharmacy' }

export const shiftsSample: SampleDefinition = {
  id: 'shifts',
  title: 'Shifts & Roster',
  initial: 'assigned',
  fields: [
    { key: 'staff', label: 'Staff member', options: () => STAFF.map(person => ({ value: person.name, label: `${person.name} · ${person.role}` })) },
    { key: 'starts', label: 'Shift start', type: 'datetime-local' },
    { key: 'ends', label: 'Shift end', type: 'datetime-local' },
    { key: 'department', label: 'Department', options: DEPARTMENTS },
  ],
  actions: [
    { id: 'clockin', label: 'Simulated clock-in', from: ['assigned'], to: 'on-duty' },
    { id: 'clockout', label: 'Simulated clock-out', from: ['on-duty'], to: 'completed', fields: [{ key: 'handover', label: 'Handover notes', type: 'textarea' }] },
  ],
  apply: ({ action, at }) => action.id === 'clockin' ? { values: { clockinAt: at } } : action.id === 'clockout' ? { values: { clockoutAt: at } } : {},
  records: [
    row('c4a2d06b-9c0d-4e1f-9a2b-1e0f3a4b5c11', 'on-duty', { ...nurseShift, clockinAt: '2026-10-26T11:41:16.657Z' }, '2026-10-26T11:41:16.657Z', [
      { at: '2026-10-26T11:41:16.657Z', status: 'assigned', reason: 'Simulated clock-in', values: nurseShift },
    ]),
    row('fc22475a-0d1e-4f2a-8b3c-2f1a4b5c6d12', 'assigned',
      { staff: 'Demo Doctor B', starts: '2026-11-02T16:00', ends: '2026-11-03T00:00', department: 'Emergency' }, '2026-10-26T11:41:16.000Z'),
    row('8e31b5c2-1e2f-4a3b-9c4d-3a2b5c6d7e13', 'completed', {
      ...pharmacyShift, clockinAt: '2026-10-26T11:41:15.100Z', handover: 'No open tasks (fictional).', clockoutAt: '2026-10-26T11:41:15.900Z',
    }, '2026-10-26T11:41:15.900Z', [
      { at: '2026-10-26T11:41:15.100Z', status: 'assigned', reason: 'Simulated clock-in', values: pharmacyShift },
      { at: '2026-10-26T11:41:15.900Z', status: 'on-duty', reason: 'Simulated clock-out', values: { ...pharmacyShift, clockinAt: '2026-10-26T11:41:15.100Z' } },
    ]),
  ],
}

const VEHICLE_ROWS: readonly SampleRecord[] = [
  row('4ac0f82a-2f3a-4b4c-8d5e-4b3c6d7e8f14', 'dispatched', { name: 'DEMO-VEHICLE', crew: 'Fictional crew' }, '2026-10-26T11:41:13.000Z'),
  row('6a6ad35b-3a4b-4c5d-9e6f-5c4d7e8f9a15', 'available', { name: 'AMB-02', crew: 'Demo crew 2' }, '2026-10-26T11:41:13.000Z'),
  row('d2e7a944-4b5c-4d6e-8f7a-6d5e8f9a0b16', 'maintenance', { name: 'AMB-03', crew: 'Demo crew 3', reason: 'Brake check (fictional)' },
    '2026-10-26T11:41:14.000Z', [{ at: '2026-10-26T11:41:14.000Z', status: 'available', reason: 'Brake check (fictional)', values: { name: 'AMB-03', crew: 'Demo crew 3' } }]),
]

const firstDispatch: SampleValues = { vehicle: 'DEMO-VEHICLE', pickup: 'Example A', destination: 'Example B', crew: 'Demo crew' }
const lastDispatch: SampleValues = { vehicle: 'AMB-02', pickup: 'Example E', destination: 'Example F', crew: 'Demo crew 2' }

export const ambulanceSample: SampleDefinition = {
  id: 'ambulance',
  title: 'Dispatch',
  initial: 'requested',
  fields: [
    { key: 'vehicle', label: 'Vehicle', options: () => recordOptions(VEHICLE_ROWS) },
    { key: 'pickup', label: 'Pickup location' },
    { key: 'destination', label: 'Destination' },
    { key: 'crew', label: 'Assigned crew' },
  ],
  actions: [
    { id: 'dispatch', label: 'Dispatch vehicle', from: ['requested'], to: 'dispatched' },
    { id: 'complete', label: 'Complete dispatch', from: ['dispatched'], to: 'completed', fields: [{ key: 'handover', label: 'Handover details' }] },
    { id: 'cancel', label: 'Cancel dispatch', from: ['requested', 'dispatched'], to: 'cancelled', fields: [reason] },
  ],
  records: [
    row('0465c81e-5c6d-4e7f-9a8b-7e6f9a0b1c17', 'dispatched', firstDispatch, '2026-10-26T11:41:16.578Z', [
      { at: '2026-10-26T11:41:16.578Z', status: 'requested', reason: 'Dispatch vehicle', values: firstDispatch },
    ]),
    row('57e5e7d4-6d7e-4f8a-8b9c-8f7a0b1c2d18', 'requested',
      { vehicle: 'AMB-02', pickup: 'Example C', destination: 'Example D', crew: 'Demo crew 2' }, '2026-10-26T11:41:16.000Z'),
    row('a91f3c08-7e8f-4a9b-9c0d-9a8b1c2d3e19', 'completed', { ...lastDispatch, handover: 'Handed to the ward team (fictional).' },
      '2026-10-26T11:41:15.800Z', [
        { at: '2026-10-26T11:41:15.400Z', status: 'requested', reason: 'Dispatch vehicle', values: lastDispatch },
        { at: '2026-10-26T11:41:15.800Z', status: 'dispatched', reason: 'Complete dispatch', values: lastDispatch },
      ]),
  ],
}

export const vehiclesSample: SampleDefinition = {
  id: 'vehicles',
  title: 'Vehicle configuration',
  initial: 'available',
  fields: [
    { key: 'name', label: 'Vehicle registration' },
    { key: 'crew', label: 'Default crew' },
  ],
  actions: [
    { id: 'maintenance', label: 'Maintenance', from: ['available'], to: 'maintenance', fields: [reason] },
    { id: 'release', label: 'Release vehicle', from: ['maintenance'], to: 'available', fields: [{ key: 'review', label: 'Maintenance completed' }] },
  ],
  records: VEHICLE_ROWS,
}
