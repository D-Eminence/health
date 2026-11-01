import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../kasuwa/ui'
import { AgreementSheet } from './AgreementSheet'
import { ConsentChecks, missingConsents, type ConsentItem } from './ConsentChecks'
import type { AgreementDocument } from './types'

/** What a read says: a changed version to agree to, with what changed in plain words. */
export interface AgreementChange {
  readonly needsAgreement: boolean
  readonly changes: readonly string[]
}

/**
 * Asks once, after sign-in, whether a changed agreement needs agreeing to: `load` is the proposed read (GET
 * identity/me/consents, or identity/facility-agreements/current for an administrator). Only an answer that says
 * `needsAgreement: true` shows the screen; a 404, any refusal or fault, or a slow answer shows nothing and stops
 * nothing. Returns the change to show, and `done` to put it away.
 */
export function useAgreementChange(load: (() => Promise<AgreementChange>) | null) {
  const [change, setChange] = useState<AgreementChange | null>(null)
  useEffect(() => {
    if (!load) return
    let live = true
    Promise.resolve().then(load).then(answer => { if (live && answer?.needsAgreement) setChange(answer) }, () => undefined)
    return () => { live = false }
  }, [load])
  return { change, done: () => setChange(null) }
}

/**
 * "We've updated our agreement": one screen over the app, with up to three lines of what changed, the full agreement
 * in a sheet, the required tick(s) and Agree (the one primary: rightmost on a computer, at the bottom on a phone). Agree
 * with a box unticked says so under it and moves focus there. The agreement is recorded by `onAgree`, whose refusal
 * never keeps the person here: the screen goes as soon as they agree.
 */
export function AgreementChanged({ document, changes, items, onAgree }: {
  readonly document: AgreementDocument
  readonly changes: readonly string[]
  readonly items: readonly ConsentItem[]
  readonly onAgree: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [checked, setChecked] = useState<Readonly<Record<string, boolean>>>({})
  const [errors, setErrors] = useState<readonly string[]>([])
  const [focusRequest, setFocusRequest] = useState(0)
  const [reading, setReading] = useState(false)
  // The agreement is linked once, above the boxes: not again under one of them.
  const boxes = items.map(({ document: _linked, readLabel: _words, ...item }) => item)
  // Focus moves to the heading in the commit that shows the screen, so it is read first.
  useLayoutEffect(() => { heading.current?.focus() }, [])

  const agree = () => {
    const missing = missingConsents(items, checked)
    setErrors(missing)
    if (missing.length) { setFocusRequest(value => value + 1); return }
    onAgree()
  }

  return <div className="fixed inset-0 z-[var(--z-dialog)] overflow-y-auto bg-[var(--color-page)]" role="dialog" aria-modal="true"
    aria-labelledby="hid-agreement-changed-title">
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center px-4 py-10">
      <form noValidate onSubmit={event => { event.preventDefault(); agree() }}
        className="flex flex-col gap-5 rounded-2xl bg-surface p-5 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-6">
        <h1 ref={heading} id="hid-agreement-changed-title" tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">We’ve updated our agreement</h1>
        {changes.length > 0 && <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2 marker:text-ink-3">
          {changes.slice(0, 3).map(line => <li key={line}>{line}</li>)}
        </ul>}
        <button type="button" onClick={() => setReading(true)}
          className="inline-flex min-h-11 cursor-pointer items-center self-start border-0 bg-transparent p-0 text-left font-[inherit] text-sm font-medium text-brand-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
          Read the full agreement</button>
        <ConsentChecks idPrefix="hid-agreement-changed" items={boxes} checked={checked} errors={errors} focusRequest={focusRequest}
          onChange={(id, value) => { setChecked(current => ({ ...current, [id]: value })); if (value) setErrors(current => current.filter(other => other !== id)) }} />
        <div className="flex flex-col sm:flex-row sm:justify-end">
          <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto">Agree</Button>
        </div>
      </form>
    </div>
    <AgreementSheet document={document} open={reading} onClose={() => setReading(false)} />
  </div>
}
