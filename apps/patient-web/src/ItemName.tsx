import type { ReactNode } from 'react'

/**
 * The rest of a repeated button's name, for assistive technology only: the item
 * it acts on, with something unique to it (NEW-AMBIGUOUS-ACTION-NAMES). The
 * visible text stays the start of the name.
 */
export function ItemName({ children }: { children: ReactNode }) {
  return <span className="patient-visually-hidden">{children}</span>
}
