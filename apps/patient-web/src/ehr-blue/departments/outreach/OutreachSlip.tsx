import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { OutreachCampaign, OutreachCase } from '../../../staff/api'
import { dateText } from '../parts/format'
import { ageText, caseName, sexText } from './outreachParts'
import './outreachSlip.css'

/*
 * The slip a person registered at an outreach takes home: who registered them and where, when, and their Health ID if
 * they have one. Built only from what the page already holds; nothing is fetched to print and nothing is kept. Never a
 * health value: at most that health checks were recorded. The claim code is printed only when the page that made the
 * Health ID passes it in: from its memory, or for 15 minutes from this tab's own copy after a reload (tabMemory.ts).
 * Health ID never answers it again, so it can't be printed after that.
 */

/** Where a person without a Health ID can get one later. */
export const GET_HEALTH_ID_LATER = 'You can get a Health ID later at app.healthidentitydirectory.com.'
/** As GET_HEALTH_ID_LATER, for anyone under 18: a parent or guardian gets it for them. */
export const GET_HEALTH_ID_LATER_MINOR = 'A parent or guardian can get them a Health ID later at app.healthidentitydirectory.com.'
export const KEEP_SLIP = 'Keep this slip. You’ll need your Health ID and this code to start using it.'
export const CHECKS_RECORDED = 'Health checks were recorded today.'
/** A Health ID made by email (0119) has no password yet: the person sets one with "Forgot password". */
export const FORGOT_PASSWORD = 'To start using your Health ID, open the Health ID app, tap “Forgot password?” and use the email you gave today.'

/**
 * Prints a slip: it is put under <body> (outreachSlip.css hides it on screen and prints it alone), window.print runs in
 * the commit that shows it, and it goes once the print dialog closes.
 */
export function useSlipPrint() {
  const [slip, setSlip] = useState<{ node: ReactNode; round: number } | null>(null)
  useLayoutEffect(() => {
    if (!slip) return
    const done = () => setSlip(current => current?.round === slip.round ? null : current)
    window.addEventListener('afterprint', done, { once: true })
    try { window.print() } catch { done() }
    return () => window.removeEventListener('afterprint', done)
  }, [slip])
  const print = useCallback((node: ReactNode) => setSlip(current => ({ node, round: (current?.round ?? 0) + 1 })), [])
  const area = slip && typeof document !== 'undefined'
    ? createPortal(<div data-outreach-slip="" aria-hidden="true">{slip.node}</div>, document.body)
    : null
  return { print, area }
}

/** The last day a claim code works, as "14 May 2027", or '' when not known. */
function untilText(value: string | undefined): string {
  if (!value) return ''
  const day = new Date(value)
  return Number.isNaN(day.getTime()) ? '' : day.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** A day as "14 Nov 2026". */
function dayText(value: string | null | undefined): string {
  if (!value) return ''
  const day = new Date(value)
  return Number.isNaN(day.getTime()) ? '' : day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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
      <header className="hid-outreach-slip-head">
        {groupName ? <p className="hid-outreach-slip-group">{groupName}</p> : null}
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
