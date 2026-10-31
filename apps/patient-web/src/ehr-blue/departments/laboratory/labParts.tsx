import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { EhrButton } from '@hid/ui/ehr'

/*
 * Small pieces of the Laboratory page in the target's look: the record's one "Available actions" card that holds a form
 * opened from it, an action button in that card, and the places in the record where an accession's parts are drawn.
 * The page's fields are EhrFields given the control's id (controlId), so a refusal made by useFieldProblems and focus
 * after a step both find the control; the field ties its error to it.
 */

/** Said in an actions card that offers nothing. */
export const NO_ACTIONS = 'No further actions for your permission and this record state.'

/** The record's "Saved record" heading, where focus goes once an accession is created there. */
export const SAVED_TITLE_ID = 'lab-saved-title'

/**
 * The target's "Available actions" card: its actions stacked full width, the form of the one opened under them, and a
 * line saying there is nothing to do when `none`. The stack stays mounted throughout, as the accession draws its own
 * actions into it (LabSlot).
 */
export function LabActions({ none, children }: {
  readonly none: boolean
  readonly children?: ReactNode
}) {
  return (
    <section className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-actions-card">
      <h2 className="hid-ehr-card-title">Available actions</h2>
      <div className="hid-ehr-dept-action-stack">{children}</div>
      {none ? <p className="hid-ehr-dept-muted">{NO_ACTIONS}</p> : null}
    </section>
  )
}

/** One action of the card: a full-width secondary button that opens its form under the card's actions. */
export function LabActionButton({ id, open, onToggle, children }: {
  readonly id?: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly children: ReactNode
}) {
  return <EhrButton id={id} variant="secondary" aria-expanded={open} onClick={onToggle}>{children}</EhrButton>
}

/** A status in the target's words: lower case, without underscores. */
export function statusWord(status: string) {
  return status.replaceAll('_', ' ').toLowerCase()
}

/**
 * Whether a part of the accession offers something in the actions card, nothing, or cannot say yet (its read is
 * running, or its results are hidden): "No further actions" is said only once every part has settled on nothing.
 */
export type LabOffer = 'some' | 'none' | 'unsettled'

/** What several parts offer together. */
export function combineOffers(offers: readonly LabOffer[]): LabOffer {
  if (offers.includes('some')) return 'some'
  return offers.includes('unsettled') ? 'unsettled' : 'none'
}

/**
 * Where the record draws what an accession holds outside its "Saved record": its actions in the one "Available
 * actions" card, and its results' preserved versions after "Connected hospital history". Null until the record has
 * drawn them.
 */
export interface LabSlotTargets {
  readonly actions: HTMLElement | null
  readonly history: HTMLElement | null
}

export const LabSlots = createContext<LabSlotTargets>({ actions: null, history: null })

/**
 * Draws `children` in the record's `to` place, keeping the state of the part that draws them. Each part has a wrapper of
 * its own, mounted with the part, so what it adds later stays in its place among the others.
 */
export function LabSlot({ to, children }: { readonly to: keyof LabSlotTargets; readonly children?: ReactNode }) {
  const target = useContext(LabSlots)[to]
  return target ? createPortal(<div className="hid-ehr-dept-laboratory-part">{children}</div>, target) : null
}
