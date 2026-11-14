import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/** The design's sixteen demo roles (design/ehr-target src/model.ts), each with a sample dashboard. */
export const DEMO_ROLES = [
  'Platform Super Admin', 'Hospital Owner', 'Medical Director', 'Hospital Admin', 'Consultant', 'Doctor', 'Nurse', 'Receptionist',
  'Records Officer', 'Lab Manager', 'Lab Scientist', 'Pharmacy Manager', 'Pharmacist', 'Billing Officer', 'Cashier', 'Radiology Reporter',
] as const

export type DemoRole = (typeof DEMO_ROLES)[number]

interface RoleView {
  /** The role whose sample dashboard Home shows, or null for the person's own live Home. */
  readonly viewing: DemoRole | null
  readonly view: (role: DemoRole | null) => void
}

const RoleViewContext = createContext<RoleView>({ viewing: null, view: () => {} })

/** Which role's sample dashboard is shown: memory only, so a reload or a new session starts on the person's own Home. */
export function RoleViewProvider({ children }: { readonly children: ReactNode }) {
  const [viewing, setViewing] = useState<DemoRole | null>(null)
  const value = useMemo(() => ({ viewing, view: setViewing }), [viewing])
  return <RoleViewContext.Provider value={value}>{children}</RoleViewContext.Provider>
}

export function useRoleView(): RoleView {
  return useContext(RoleViewContext)
}
