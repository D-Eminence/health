import { formatDate } from '@hid/ui/display'
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { OutreachCampaign, OutreachCase } from '../../../staff/api'
import { dateText } from '../parts/format'
import { PrintHeader } from '../../frame/PrintHeader'
import { startPrint, type PrintJob } from '../../../print/printPaper'
import { ageText, caseName, sexText } from './outreachParts'
import './outreachSlip.css'

/*
 * The slip a person registered at an outreach takes home: who registered them and where, when, and their Health ID if
 * they have one. Built only from what the page already holds; nothing is fetched to print and nothing is kept. Never a
 * health value: at most that health checks were recorded. The claim code is printed only when the page that made the
 * Health ID passes it in: from its memory, or for 15 minutes from this tab's own copy after a reload (tabMemory.ts).
 * Health ID never answers it again, so it can't be printed after that.
 */

/** Where a person without a Health ID can get one later. No web address: nothing printed carries one (owner, 23 Nov 2026). */
export const GET_HEALTH_ID_LATER = 'You can get a Health ID later at any Health ID facility or on the Health ID app.'
/** As GET_HEALTH_ID_LATER, for anyone under 18: a parent or guardian gets it for them. */
export const GET_HEALTH_ID_LATER_MINOR = 'A parent or guardian can get them a Health ID later at any Health ID facility or on the Health ID app.'
export const KEEP_SLIP = 'Keep this slip. You’ll need your Health ID and this code to start using it.'
export const CHECKS_RECORDED = 'Health checks were recorded today.'
/** A Health ID made by email (0119) has no password yet: the person sets one with "Forgot password". */
export const FORGOT_PASSWORD = 'To start using your Health ID, open the Health ID app, tap “Forgot password?” and use the email you gave today.'

/**
 * Prints a slip: it is put under <body> (outreachSlip.css hides it on screen and prints it alone), it prints in the
 * commit that shows it (as a PDF in Safari, printPaper.ts: no browser prints its web address on it), and it goes once
 * it has printed. Its title names the facility, never the person.
 */
export function useSlipPrint() {
  const [slip, setSlip] = useState<{ node: ReactNode; round: number; job: PrintJob } | null>(null)
  const area = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!slip) return
    return slip.job.run(area.current, () => setSlip(current => current?.round === slip.round ? null : current))
  }, [slip])
  const print = useCallback((node: ReactNode) => {
    const job = startPrint({ size: 'A6', kind: 'Registration slip' })
    setSlip(current => ({ node, round: (current?.round ?? 0) + 1, job }))
  }, [])
  const portal = slip && typeof document !== 'undefined'
    ? createPortal(<div ref={area} data-outreach-slip="" aria-hidden="true">{slip.node}</div>, document.body)
    : null
  return { print, area: portal }
}

/** The last day a claim code works, as "14 May 2027", or '' when not known. */
function untilText(value: string | undefined): string {
  return formatDate(value)
}

/** A day as "14 Nov 2026". */
function dayText(value: string | null | undefined): string {
  return formatDate(value)
}

/** The campaign's day, or its first and last day when it runs over more than one. */
export function eventDateText(campaign: Pick<OutreachCampaign, 'startsAt' | 'endsAt'> | undefined): string {
  const start = dayText(campaign?.startsAt)
  const end = dayText(campaign?.endsAt)
  return start && end && end !== start ? `${start} to ${end}` : start
}

export function OutreachSlip({ groupName, campaign, item, healthId, claimCode, claimExpiresAt, byEmail = false }: {
  /** The outreach group (or the facility whose outreach team registered them). */
  readonly groupName: string | undefined
  readonly campaign: Pick<OutreachCampaign, 'name' | 'startsAt' | 'endsAt'> | undefined
  readonly item: OutreachCase
  /** Their Health ID, when they have one. */
  readonly healthId: string | null | undefined
  /** Only straight after a Health ID was made here with no email (“No email”). */
  readonly claimCode?: string
  /** Until when the claim code works (0120's claimExpiresAt), when the page that made it still holds it. */
  readonly claimExpiresAt?: string
  /** The Health ID was made at outreach by email: it has no password yet. */
  readonly byEmail?: boolean
}) {
  const eventDate = eventDateText(campaign)
  const until = untilText(claimExpiresAt)
  const facts: Array<[string, string]> = [
    ['Name', caseName(item)],
    ['Age and sex', `${ageText(item)} · ${sexText(item)}`],
    ...(campaign ? [['Campaign', campaign.name] as [string, string]] : []),
    ...(eventDate ? [['Event date', eventDate] as [string, string]] : []),
    ['Registered', dateText(item.createdAt)],
  ]
  return (
    <article className="hid-outreach-slip">
      <PrintHeader facility={groupName} className="hid-outreach-slip-brand" />
      <header className="hid-outreach-slip-head">
        <h1>Outreach registration slip</h1>
      </header>
      <dl className="hid-outreach-slip-facts">
        {facts.map(([label, value]) => <div key={label} className="contents"><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {healthId ? (
        <section>
          <h2>Health ID</h2>
          <p className="hid-outreach-slip-big">{healthId}</p>
          {claimCode ? <>
            <h2>Claim code</h2>
            <p className="hid-outreach-slip-big">{claimCode}</p>
            <p className="hid-outreach-slip-note">{KEEP_SLIP}{until ? ` The code works until ${until}.` : null}</p>
          </> : byEmail ? <p className="hid-outreach-slip-note">{FORGOT_PASSWORD}</p> : null}
        </section>
      ) : <p>{typeof item.ageYears === 'number' && item.ageYears < 18 ? GET_HEALTH_ID_LATER_MINOR : GET_HEALTH_ID_LATER}</p>}
      {item.hasScreening ? <p>{CHECKS_RECORDED}</p> : null}
      <p className="hid-outreach-slip-foot">Show this slip if you visit a clinic or come back to the outreach.</p>
    </article>
  )
}
