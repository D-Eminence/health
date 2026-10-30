import {
  above, QUANTITY_TEXT, recordOptions, wholeAbove, type SampleBatch, type SampleDefinition, type SampleRecord, type SampleTabs, type SampleValues,
} from '../parts/sample/model'

/*
 * Sample definitions: Stock and Procurement, the design's Supply module. Fields, actions and statuses follow the
 * design's catalogue; every row is fictional.
 */

const SUPPLY_TABS: SampleTabs = {
  label: 'Supply',
  tabs: [{ id: 'inventory', label: 'Stock' }, { id: 'procurement', label: 'Procurement' }],
}

const reason = { key: 'reason', label: 'Reason', type: 'textarea' } as const

const medA: SampleValues = { name: 'Fictional Med A', unit: 'tablet', packSize: '10', threshold: '20', category: 'Medication' }

const STOCK_ROWS: readonly SampleRecord[] = [
  {
    id: 'daf89334-8f9a-4b0c-8d1e-0b9c2d3e4f20',
    status: 'active',
    values: { ...medA, batch: 'DEMO-LOT', delta: '-2', reason: 'Wastage (fictional)' },
    state: { batches: [{ lot: 'DEMO-LOT', quantity: 94, expiry: '2030-01-01' }] },
    updatedAt: '2026-10-26T11:41:17.064Z',
    versions: [{ at: '2026-10-26T11:41:17.064Z', status: 'active', reason: 'Wastage (fictional)', values: medA }],
  },
  {
    id: 'f8d3f00a-9a0b-4c1d-9e2f-1c0d3e4f5a21',
    status: 'active',
    values: { name: 'Fictional Gloves', unit: 'pair', packSize: '50', threshold: '100', category: 'Consumable' },
    state: { batches: [{ lot: 'GLV-LOT-1', quantity: 400, expiry: '2028-03-31' }] },
    updatedAt: '2026-10-26T11:41:17.000Z',
    versions: [],
  },
  {
    id: '3c71b9e2-0b1c-4d2e-8f3a-2d1e4f5a6b22',
    status: 'active',
    values: { name: 'Fictional Syringe 5 ml', unit: 'piece', packSize: '100', threshold: '200', category: 'Consumable' },
    state: { batches: [] },
    updatedAt: '2026-10-26T11:41:17.000Z',
    versions: [],
  },
]

function batchesOf(record: SampleRecord): readonly SampleBatch[] {
  return record.state?.batches ?? []
}

/** The batches on this item, as an action's choices. */
function batchOptions({ record }: { readonly record?: SampleRecord }) {
  return (record ? batchesOf(record) : []).map(batch => ({ value: batch.lot, label: `${batch.lot} · ${batch.quantity} units` }))
}

export const inventorySample: SampleDefinition = {
  id: 'inventory',
  title: 'Stock',
  initial: 'active',
  tabs: SUPPLY_TABS,
  fields: [
    { key: 'name', label: 'Item name' },
    { key: 'category', label: 'Category', options: ['Medication', 'Consumable', 'Equipment'] },
    { key: 'unit', label: 'Base unit' },
    { key: 'packSize', label: 'Units per pack', type: 'number' },
    { key: 'threshold', label: 'Reorder threshold', type: 'number' },
  ],
  defaults: { packSize: '1' },
  validate: values => Number(values.packSize) < 1 || Number(values.threshold) < 0
    ? 'Pack size must be positive and reorder threshold cannot be negative.' : undefined,
  created: () => ({ state: { batches: [] } }),
  actions: [
    {
      id: 'receive', label: 'Receive stock', from: ['active'], to: 'active',
      fields: [
        { key: 'lot', label: 'Batch number' },
        { key: 'quantity', label: 'Base units received', type: 'number' },
        { key: 'expiry', label: 'Expiry', type: 'date' },
        { key: 'reference', label: 'Receipt reference' },
      ],
    },
    {
      id: 'adjust', label: 'Consume / adjust stock', from: ['active'], to: 'active',
      fields: [{ key: 'batch', label: 'Batch', options: batchOptions }, { key: 'delta', label: 'Signed unit change', type: 'number' }, reason],
    },
    {
      id: 'transfer', label: 'Transfer stock', from: ['active'], to: 'active',
      fields: [
        { key: 'batch', label: 'Batch', options: batchOptions },
        { key: 'quantity', label: 'Units to transfer', type: 'number' },
        { key: 'destination', label: 'Destination branch', options: ['Demo Hospital Annex', 'Demo Hospital North Clinic'] },
        reason,
      ],
    },
  ],
  apply: ({ record, action, values }) => {
    const batches = batchesOf(record)
    if (action.id === 'receive') {
      const quantity = wholeAbove(values.quantity)
      if (quantity === undefined) return { error: QUANTITY_TEXT }
      const lot = values.lot ?? ''
      const expiry = values.expiry ?? ''
      // The same batch received again adds to it.
      const same = batches.find(item => item.lot === lot && item.expiry === expiry)
      return {
        state: {
          ...record.state,
          batches: same ? batches.map(item => item === same ? { ...item, quantity: item.quantity + quantity } : item) : [...batches, { lot, quantity, expiry }],
        },
      }
    }
    const batch = batches.find(item => item.lot === values.batch)
    if (!batch) return { error: 'Wrong item batch.' }
    const change = action.id === 'adjust' ? Number(values.delta) : -(wholeAbove(values.quantity) ?? Number.NaN)
    if (action.id === 'adjust' && (!Number.isInteger(change) || batch.quantity + change < 0)) {
      return { error: 'Adjustment must use whole units and cannot create negative stock.' }
    }
    if (action.id === 'transfer' && (Number.isNaN(change) || batch.quantity + change < 0)) {
      return { error: 'Insufficient stock or no access to destination.' }
    }
    return { state: { ...record.state, batches: batches.map(item => item === batch ? { ...item, quantity: item.quantity + change } : item) } }
  },
  savedExtra: record => (
    <>
      <h3>Stock batches</h3>
      {batchesOf(record).map((batch, index) => <p key={`${batch.lot}-${index}`}>{batch.lot} · {batch.quantity} units · expires {batch.expiry}</p>)}
    </>
  ),
  records: STOCK_ROWS,
}

const stockRequest: SampleValues = { item: 'Fictional Med A', quantity: '20', supplier: 'Demo Supplier', reason: 'Stock request' }
const gloves: SampleValues = { item: 'Fictional Gloves', quantity: '200', supplier: 'Demo Supplier', reason: 'Glove top-up' }

export const procurementSample: SampleDefinition = {
  id: 'procurement',
  title: 'Procurement',
  initial: 'requested',
  tabs: SUPPLY_TABS,
  fields: [
    { key: 'item', label: 'Inventory item', options: () => recordOptions(STOCK_ROWS) },
    { key: 'quantity', label: 'Base units requested', type: 'number' },
    { key: 'supplier', label: 'Fictional supplier' },
    { key: 'reason', label: 'Request reason' },
  ],
  defaults: { quantity: '1' },
  validate: values => above(values.quantity) === undefined ? QUANTITY_TEXT : undefined,
  actions: [
    { id: 'approve', label: 'Approve request', from: ['requested'], to: 'approved' },
    { id: 'order', label: 'Create purchase order', from: ['approved'], to: 'ordered', fields: [{ key: 'reference', label: 'Purchase order reference' }] },
    {
      id: 'receive', label: 'Receive goods', from: ['ordered', 'partial'], to: 'partial',
      fields: [
        { key: 'quantity', label: 'Base units received', type: 'number' },
        { key: 'lot', label: 'Batch' },
        { key: 'expiry', label: 'Expiry', type: 'date' },
        { key: 'reference', label: 'Unique receipt reference' },
      ],
    },
  ],
  apply: ({ record, action, values }) => {
    if (action.id !== 'receive') return {}
    const quantity = wholeAbove(values.quantity)
    if (quantity === undefined) return { error: QUANTITY_TEXT }
    const ordered = Number(record.values.quantity)
    const received = Number(record.values.received ?? 0) + quantity
    if (received > ordered) return { error: 'Receipt exceeds the remaining purchase quantity.' }
    // The units received are kept as "Received": the request's own quantity stays as ordered.
    return { status: received === ordered ? 'closed' : 'partial', values: { quantity: record.values.quantity ?? '', received: String(received) } }
  },
  records: [
    {
      id: '1dc09f04-1c2d-4e3f-9a4b-3e2f5a6b7c23', status: 'approved', values: stockRequest, updatedAt: '2026-10-26T11:41:17.022Z',
      versions: [{ at: '2026-10-26T11:41:17.022Z', status: 'requested', reason: 'Approve request', values: stockRequest }],
    },
    {
      id: 'e180c18e-2d3e-4f4a-8b5c-4f3a6b7c8d24', status: 'requested', updatedAt: '2026-10-26T11:41:17.000Z', versions: [],
      values: { item: 'Fictional Med A', quantity: '50', supplier: 'Another Supplier', reason: 'Quarterly restock' },
    },
    {
      id: '7a2be415-3e4f-4a5b-9c6d-5a4b7c8d9e25', status: 'ordered', values: { ...gloves, reference: 'PO-DEMO-1' }, updatedAt: '2026-10-26T11:41:17.040Z',
      versions: [
        { at: '2026-10-26T11:41:17.030Z', status: 'requested', reason: 'Approve request', values: gloves },
        { at: '2026-10-26T11:41:17.040Z', status: 'approved', reason: 'Create purchase order', values: gloves },
      ],
    },
  ],
}
