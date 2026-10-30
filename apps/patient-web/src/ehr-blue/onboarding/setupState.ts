/**
 * What the sample steps (Type, Departments, Branches, Billing) hold: fictional settings kept in the wizard's component
 * state for this visit only. Nothing here is sent to Health ID or kept anywhere: leaving the page, or a reload, starts
 * again. The starting values are the design's for a new hospital (design/ehr-target src/service.ts:427-459), less the
 * facility details Health ID does not collect.
 */

export interface SampleBranch {
  readonly id: string
  readonly name: string
  readonly address: string
  readonly contact: string
  readonly hours: string
  readonly departments: readonly string[]
}

export interface SampleBilling {
  readonly currency: string
  readonly invoicePrefix: string
  /** As typed: "Cash,Transfer". */
  readonly methods: string
  readonly paymentTiming: string
  readonly insurance: boolean
}

export interface SampleSetup {
  readonly type: string
  readonly departments: readonly string[]
  readonly branches: readonly SampleBranch[]
  readonly billing: SampleBilling
}

export const MAIN_BRANCH = 'main'

/** A new branch's operating hours (src/admin.tsx:450). */
export const NEW_BRANCH_HOURS = '09:00-17:00'

export function newSetup(): SampleSetup {
  return {
    type: '',
    departments: ['General Outpatient'],
    branches: [{ id: MAIN_BRANCH, name: 'Main', address: '', contact: '', hours: NEW_BRANCH_HOURS, departments: ['General Outpatient'] }],
    billing: { currency: 'NGN', invoicePrefix: 'INV', methods: 'Cash', paymentTiming: 'After service', insurance: false },
  }
}

/** The accepted payment methods as the design keeps them: split on commas, trimmed, empty ones dropped. */
export function paymentMethods(methods: string): string[] {
  return methods.split(',').map(method => method.trim()).filter(Boolean)
}
